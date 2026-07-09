import type { VercelRequest, VercelResponse } from '@vercel/node';
import { score, typeInfo, rankBadPicks, applyAdjustments, Adjustments } from './_lib/scoring.js';
import { reportSystemPrompt, reportSchema, adjustSystemPrompt, adjustSchema } from './_lib/prompts.js';
import { chatJSON, MODEL, ChatMessage } from './_lib/openai.js';
import { dbEnabled, insertReturning, insert } from './_lib/supabase.js';
import { methodGuard, enforceRateLimit, readAnswers, clientIp } from './_lib/http.js';
import { LIMITS, RATE } from './_lib/limits.js';

const ADJ_CAP = LIMITS.adjustCap; // 축별 상담 보정 상한(±)

interface TItem { role: string; text: string }

// 상담 대화(untrusted)를 신뢰하지 않고 정규화. qaMsgs 역할: 'me'|'ai'.
function parseTranscript(input: unknown): TItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-LIMITS.transcriptMax)
    .map((m: any): TItem | null => {
      const role = m?.role === 'me' || m?.role === 'user' ? 'user' : 'assistant';
      const raw = typeof m?.text === 'string' ? m.text : typeof m?.content === 'string' ? m.content : '';
      const text = raw.slice(0, 500);
      return text ? { role, text } : null;
    })
    .filter((m): m is TItem => !!m);
}

// POST /api/report — 리포트 해설(JSON).
// 점수/유형: 시나리오 선택으로 서버 재계산(척추) → AI 상담 답변으로 축별 보정 → 최종 유형·점수 확정. narrative 만 AI 문장.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = (req.body || {}) as { sessionId?: string; answers?: unknown; phase?: string; transcript?: unknown; picks?: unknown };
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  const phase = body.phase === 'rediag' ? 'rediag' : 'diag';
  const ip = clientIp(req);
  // 리포트 세션당 분당 5회 상한.
  if (!enforceRateLimit(res, `report:${sessionId || ip}`, RATE.report.limit, RATE.report.windowMs)) return;

  const answers = readAnswers(res, body.answers);
  if (!answers) return;

  // 1차 진단(척추): 서버 재계산 (클라 값 무시)
  const base = score(answers);
  const badPicks = rankBadPicks(body.picks);
  const transcript = parseTranscript(body.transcript);

  // AI 상담 보정: 대화가 있으면 축별 가감점을 산출해 최종 점수·유형을 확정한다.
  let adjustments: Adjustments = { info: 0, emo: 0, act: 0, resp: 0 };
  let rationale = '';
  let refined = false;
  if (transcript.some((t) => t.role === 'user')) {
    try {
      const convo = transcript.map((t) => `${t.role === 'user' ? '장병' : '상담관'}: ${t.text}`).join('\n');
      const adjMessages: ChatMessage[] = [
        { role: 'system', content: adjustSystemPrompt(base, badPicks, ADJ_CAP) },
        { role: 'user', content: `[상담 대화 기록]\n${convo}\n\n위 대화의 '실제 이유'만 근거로 축별 보정치를 JSON 으로 내줘.` },
      ];
      const out = await chatJSON(adjMessages, adjustSchema, 'metaguard_adjust', { temperature: 0.2, maxTokens: 400 });
      if (out && out.adjustments) adjustments = out.adjustments as Adjustments;
      if (typeof out?.rationale === 'string') rationale = out.rationale;
      refined = true;
    } catch (e) {
      console.error('adjust failed:', (e as Error).message);
      // 보정 실패 시 1차 진단을 그대로 최종으로 사용.
    }
  }

  // 최종 결과: 보정 반영(±cap) → 유형까지 재계산.
  const final = refined ? applyAdjustments(base, adjustments, ADJ_CAP) : base;
  const ti = typeInfo(final.code);

  // 진단 결과 저장(최종 값) — best-effort.
  let diagnosisId: string | null = null;
  if (dbEnabled && sessionId) {
    try {
      const row = await insertReturning<{ id: string }>('diagnoses', {
        session_id: sessionId, answers, type_code: final.code, scores: final.scores, phase,
      });
      diagnosisId = row.id;
    } catch (e) {
      console.error('diagnosis insert failed:', (e as Error).message);
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: reportSystemPrompt(final, refined) },
    { role: 'user', content: '위 확정 결과에 맞춰 이 장병 개인 맞춤 해설을 JSON 으로 작성해줘.' },
  ];

  let narrative: any;
  try {
    narrative = await chatJSON(messages, reportSchema, 'metaguard_report', { temperature: 0.7, maxTokens: 700 });
  } catch (e) {
    console.error('report generation failed:', (e as Error).message);
    // AI 실패 시 프론트가 결정론 리포트로 폴백하도록 502.
    return res.status(502).json({ error: 'upstream_failed' });
  }

  // 생성 리포트 저장 — best-effort.
  if (dbEnabled && diagnosisId) {
    try {
      await insert('reports', { diagnosis_id: diagnosisId, narrative, model: MODEL });
    } catch (e) {
      console.error('report insert failed:', (e as Error).message);
    }
  }

  return res.status(200).json({
    typeCode: final.code,
    typeName: ti.name,
    scores: final.scores,
    narrative,
    // 상담 보정 메타(프론트에서 '보정됨' 표시·최종 점수 렌더에 사용)
    refined,
    adjustments,
    rationale,
    baseTypeCode: base.code,
    baseScores: base.scores,
  });
}
