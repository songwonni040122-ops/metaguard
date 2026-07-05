import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAnswers, score, typeInfo } from './_lib/scoring.js';
import { reportSystemPrompt, reportSchema } from './_lib/prompts.js';
import { chatJSON, MODEL, ChatMessage } from './_lib/openai.js';
import { dbEnabled, insertReturning, insert } from './_lib/supabase.js';
import { rateLimit, clientIp } from './_lib/ratelimit.js';

// POST /api/report — 리포트 해설(JSON). typeCode/scores 는 서버 재계산, narrative 만 AI.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body || {}) as { sessionId?: string; answers?: unknown; phase?: string };
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  const phase = body.phase === 'rediag' ? 'rediag' : 'diag';
  const ip = clientIp(req);
  // 리포트 세션당 분당 5회 상한.
  if (!rateLimit(`report:${sessionId || ip}`, 5, 60_000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  let answers;
  try {
    answers = validateAnswers(body.answers);
  } catch (e) {
    return res.status(400).json({ error: 'invalid_answers', detail: (e as Error).message });
  }

  // 척추: 서버 재계산 (클라 값 무시)
  const s = score(answers);
  const ti = typeInfo(s.code);

  // 진단 결과 저장 — best-effort.
  let diagnosisId: string | null = null;
  if (dbEnabled && sessionId) {
    try {
      const row = await insertReturning<{ id: string }>('diagnoses', {
        session_id: sessionId, answers, type_code: s.code, scores: s.scores, phase,
      });
      diagnosisId = row.id;
    } catch (e) {
      console.error('diagnosis insert failed:', (e as Error).message);
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: reportSystemPrompt(s) },
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
    typeCode: s.code,
    typeName: ti.name,
    scores: s.scores,
    narrative,
  });
}
