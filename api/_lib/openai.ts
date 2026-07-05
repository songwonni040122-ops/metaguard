// OpenAI 호출 래퍼. 의존성 없이 전역 fetch 사용(Node 20).
// 모델 id 는 env(OPENAI_MODEL)로 주입 — 배포 직전 콘솔에서 확정 (DESIGN.md).

const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
// 일부 최신 모델은 temperature 커스텀을 지원하지 않음 → env 로 끌 수 있게.
const SUPPORTS_TEMPERATURE = process.env.OPENAI_NO_TEMPERATURE !== '1';
// gpt-5 계열 추론 모델: reasoning_effort='none' 로 두면 추론 토큰 소모/지연 최소화(가장 저렴·빠름).
// gpt-4o 등 미지원 모델을 쓰면 env 를 비워 파라미터를 생략한다.
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || '';

function applyTuning(body: Record<string, unknown>, temperature?: number): void {
  if (SUPPORTS_TEMPERATURE && temperature != null) body.temperature = temperature;
  if (REASONING_EFFORT) body.reasoning_effort = REASONING_EFFORT;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function authHeaders(): Record<string, string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

async function safeText(r: Response): Promise<string> {
  try { return (await r.text()).slice(0, 500); } catch { return '<no body>'; }
}

// 스트리밍 챗: OpenAI SSE 바디(ReadableStream)를 그대로 반환한다.
export async function chatStream(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<ReadableStream<Uint8Array>> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    stream: true,
    max_completion_tokens: opts.maxTokens ?? 300,
  };
  applyTuning(body, opts.temperature);

  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) throw new Error(`openai chat ${r.status}: ${await safeText(r)}`);
  return r.body;
}

// 구조화 출력(JSON) — 리포트 해설.
export async function chatJSON(
  messages: ChatMessage[],
  schema: unknown,
  schemaName: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<any> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_completion_tokens: opts.maxTokens ?? 700,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    },
  };
  applyTuning(body, opts.temperature);

  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`openai json ${r.status}: ${await safeText(r)}`);
  const j: any = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error('openai json: empty content');
  return JSON.parse(content);
}
