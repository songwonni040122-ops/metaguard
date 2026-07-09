import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAnswers, score, rankBadPicks } from './_lib/scoring.js';
import { chatSystemPrompt, openingSystemPrompt } from './_lib/prompts.js';
import { chatStream, ChatMessage } from './_lib/openai.js';
import { dbEnabled, insert } from './_lib/supabase.js';
import { rateLimit, clientIp } from './_lib/ratelimit.js';

const MAX_QUESTIONS = 6; // 아쉬운 선택 2~3개 × 1~2턴 → 6개까지 질문, 이후 프롬프트가 자연스럽게 마무리
const MAX_MESSAGE_LEN = 500;
const MAX_HISTORY = 12;

interface HistoryItem { role?: string; text?: string }

// POST /api/chat — QA 챗봇 스트리밍(SSE). 프론트는 실패 시 규칙기반 폴백.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body || {}) as {
    sessionId?: string; answers?: unknown; turn?: number;
    history?: HistoryItem[]; message?: unknown;
    opening?: boolean; picks?: unknown;
  };

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  const ip = clientIp(req);
  // 챗봇 분당 10회 (세션 우선, 없으면 IP).
  if (!rateLimit(`chat:${sessionId || ip}`, 10, 60_000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  // opening=true: 사용자 메시지 없이, 진단 선택만으로 '첫 질문'을 AI가 생성한다.
  const opening = body.opening === true;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!opening) {
    if (!message) return res.status(400).json({ error: 'empty_message' });
    if (message.length > MAX_MESSAGE_LEN) return res.status(400).json({ error: 'message_too_long' });
  }

  let weakAxes;
  try {
    weakAxes = score(validateAnswers(body.answers)).weakAxes;
  } catch (e) {
    return res.status(400).json({ error: 'invalid_answers', detail: (e as Error).message });
  }

  // 프롬프트 인젝션 방지: 사용자 입력은 항상 user 역할로만. 시스템 규칙 우선.
  const turnNum = Number.isFinite(body.turn) ? Math.max(1, Number(body.turn)) : 1;
  // 사용자가 점수를 낮춘 '아쉬운 선택' 상위 3개 → 이걸 콕 집어 이유를 묻는다.
  const badPicks = rankBadPicks(body.picks);
  let messages: ChatMessage[];
  if (opening) {
    // 첫 질문: 가장 아쉬운 선택을 콕 집어 이유를 묻는 오프닝. 히스토리/유저 메시지 없음.
    messages = [
      { role: 'system', content: openingSystemPrompt(weakAxes, badPicks) },
      { role: 'user', content: '진단이 끝났어요. 제 선택을 보고 첫 질문을 해주세요.' },
    ];
  } else {
    messages = [{ role: 'system', content: chatSystemPrompt(weakAxes, badPicks, MAX_QUESTIONS, turnNum) }];
    const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
    for (const h of history) {
      const text = typeof h?.text === 'string' ? h.text.slice(0, MAX_MESSAGE_LEN) : '';
      if (!text) continue;
      messages.push({ role: h.role === 'ai' || h.role === 'assistant' ? 'assistant' : 'user', content: text });
    }
    messages.push({ role: 'user', content: message });
  }

  // SSE 헤더
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let full = '';
  try {
    const stream = await chatStream(messages, { temperature: 0.6, maxTokens: 300 });
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch { /* 부분 청크 무시 */ }
      }
    }
    // 대화 로그 저장(저장 결정) — 반드시 res.end() 전에 await.
    // (서버리스는 응답 종료 후 인스턴스를 정지시켜, end() 뒤의 async 작업이 유실됨)
    if (dbEnabled && sessionId && full) {
      // 오프닝은 사용자 메시지가 없으므로 assistant(turn 0)만 저장.
      const turn = opening ? 0 : (Number.isFinite(body.turn) ? Number(body.turn) : null);
      try {
        if (!opening) await insert('chat_messages', { session_id: sessionId, role: 'user', content: message, turn });
        await insert('chat_messages', { session_id: sessionId, role: 'assistant', content: full, turn });
      } catch (e) {
        console.error('chat log failed:', (e as Error).message);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (e) {
    console.error('chat stream failed:', (e as Error).message);
    // 스트림 시작 전 실패면 프론트가 폴백하도록 500.
    if (!res.headersSent) return res.status(500).json({ error: 'upstream_failed' });
    res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
    return res.end();
  }
}
