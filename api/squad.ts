import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { dbEnabled, insertReturning, insertManyReturning, insert, select, update, upsert } from './_lib/supabase.js';
import { methodGuard, enforceRateLimit, fail, clientIp } from './_lib/http.js';
import { LIMITS, RATE } from './_lib/limits.js';

// POST /api/squad — 분대 공유 원칙 + 채팅. action 디스패치.
// 쓰기는 모두 여기(service_role)를 거친다. 읽기·실시간은 클라가 anon Realtime으로 직접.

// 혼동 문자(I,O,0,1,L) 제외.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(n = 6): string {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

// 현재 UI의 프리셋 4개(기본 on/off = [true,true,false,false] 유지).
const PRESETS: { text: string; enabled: boolean }[] = [
  { text: '출처가 불분명한 정보는 공유 전에 반드시 교차검증한다', enabled: true },
  { text: '감정을 자극하는 콘텐츠일수록 한 박자 멈추고 사실을 먼저 확인한다', enabled: true },
  { text: '딥페이크·기만 문자를 발견하면 즉시 캡처해 지휘계통에 신고한다', enabled: false },
  { text: '동료가 동요하면 비난하지 않고 정확한 사실로 함께 안정시킨다', enabled: false },
];

interface Squad { id: string; code: string }

function cleanName(v: unknown): string {
  const s = (typeof v === 'string' ? v : '').trim().slice(0, LIMITS.squadNameMax);
  return s || '전우';
}
function cleanCode(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(s) ? s : null;
}
function cleanSession(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-fA-F-]{16,40}$/.test(v) ? v : null;
}

async function squadByCode(code: string): Promise<Squad | null> {
  const rows = await select<Squad>('squads', `code=eq.${code}&select=id,code&limit=1`);
  return rows[0] || null;
}

async function fullState(squadId: string) {
  const [members, principles, messages] = await Promise.all([
    select('squad_members', `squad_id=eq.${squadId}&select=session_id,name,joined_at&order=joined_at`),
    select('squad_principles', `squad_id=eq.${squadId}&select=id,text,source,enabled,sort_idx&order=sort_idx`),
    select('squad_messages', `squad_id=eq.${squadId}&select=id,session_id,name,text,created_at&order=created_at.desc&limit=${LIMITS.squadMsgHistory}`),
  ]);
  (messages as any[]).reverse(); // 오래된→최신
  return { members, principles, messages };
}

interface Ctx { res: VercelResponse; body: Record<string, unknown>; sessionId: string | null; squad?: Squad; }
interface ActionDef { rate: { limit: number; windowMs: number }; needsSquad: boolean; run: (c: Ctx) => Promise<VercelResponse | void>; }

const ACTIONS: Record<string, ActionDef> = {
  // ---- 방 생성 ----
  create: { rate: RATE.squad.create, needsSquad: false, run: async ({ res, body, sessionId }) => {
    const name = cleanName(body.name);
    // 코드 충돌 시 재시도.
    let squad: Squad | null = null;
    for (let i = 0; i < 5 && !squad; i++) {
      const code = genCode();
      try {
        squad = await insertReturning<Squad>('squads', { code, created_by: sessionId });
      } catch (e) {
        if (String((e as Error).message).includes('409') || String((e as Error).message).includes('duplicate')) continue;
        throw e;
      }
    }
    if (!squad) return fail(res, 500, 'code_gen_failed');
    await insertManyReturning('squad_principles', PRESETS.map((p, i) => ({
      squad_id: squad!.id, text: p.text, source: 'preset', enabled: p.enabled, sort_idx: i, created_by: sessionId,
    })));
    await insert('squad_members', { squad_id: squad.id, session_id: sessionId, name });
    return res.status(200).json({ squadId: squad.id, code: squad.code, ...(await fullState(squad.id)) });
  } },

  // ---- 방 참여 ----
  join: { rate: RATE.squad.join, needsSquad: false, run: async ({ res, body, sessionId }) => {
    const code = cleanCode(body.code);
    if (!code) return fail(res, 400, 'invalid_code');
    const squad = await squadByCode(code);
    if (!squad) return fail(res, 404, 'squad_not_found');
    await upsert('squad_members', { squad_id: squad.id, session_id: sessionId, name: cleanName(body.name) }, 'squad_id,session_id');
    return res.status(200).json({ squadId: squad.id, code: squad.code, ...(await fullState(squad.id)) });
  } },

  // ---- 폴링 폴백용 상태 조회 ----
  state: { rate: RATE.squad.state, needsSquad: true, run: async ({ res, squad }) =>
    res.status(200).json({ squadId: squad!.id, code: squad!.code, ...(await fullState(squad!.id)) }) },

  // ---- 원칙 토글(공유) ----
  toggle: { rate: RATE.squad.toggle, needsSquad: true, run: async ({ res, body, squad }) => {
    const principleId = cleanSession(body.principleId);
    if (!principleId) return fail(res, 400, 'invalid_principle');
    const enabled = body.enabled === true;
    await update('squad_principles', `id=eq.${principleId}&squad_id=eq.${squad!.id}`, { enabled });
    return res.status(200).json({ ok: true });
  } },

  // ---- 커스텀 원칙 추가 ----
  add: { rate: RATE.squad.add, needsSquad: true, run: async ({ res, body, sessionId, squad }) => {
    const text = (typeof body.text === 'string' ? body.text : '').trim().slice(0, LIMITS.squadTextMax);
    if (!text) return fail(res, 400, 'empty_text');
    const last = await select<{ sort_idx: number }>('squad_principles', `squad_id=eq.${squad!.id}&select=sort_idx&order=sort_idx.desc&limit=1`);
    const sort_idx = (last[0]?.sort_idx ?? -1) + 1;
    await insert('squad_principles', { squad_id: squad!.id, text, source: 'custom', enabled: true, sort_idx, created_by: sessionId });
    return res.status(200).json({ ok: true });
  } },

  // ---- 채팅 전송 ----
  send: { rate: RATE.squad.send, needsSquad: true, run: async ({ res, body, sessionId, squad }) => {
    const text = (typeof body.text === 'string' ? body.text : '').trim().slice(0, LIMITS.squadMsgMax);
    if (!text) return fail(res, 400, 'empty_message');
    await insert('squad_messages', { squad_id: squad!.id, session_id: sessionId, name: cleanName(body.name), text });
    return res.status(200).json({ ok: true });
  } },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!dbEnabled) return fail(res, 503, 'db_disabled');

  const body = (req.body || {}) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const sessionId = cleanSession(body.sessionId);
  const rlKey = `squad:${sessionId || clientIp(req)}`;

  const def = ACTIONS[action];
  if (!def) return fail(res, 400, 'unknown_action');

  try {
    // needsSquad 액션: 코드 검증(400)→분대 조회(404)를 rate limit 앞에서 수행(기존 순서 보존).
    let squad: Squad | undefined;
    if (def.needsSquad) {
      const code = cleanCode(body.code);
      if (!code) return fail(res, 400, 'invalid_code');
      const found = await squadByCode(code);
      if (!found) return fail(res, 404, 'squad_not_found');
      squad = found;
    }
    if (!enforceRateLimit(res, `${rlKey}:${action}`, def.rate.limit, def.rate.windowMs)) return;
    return await def.run({ res, body, sessionId, squad });
  } catch (e) {
    console.error('squad action failed:', action, (e as Error).message);
    return fail(res, 500, 'squad_failed');
  }
}
