// 핸들러 공통 보일러플레이트(메서드 가드 / rate limit / 에러 응답 / answers 검증).
// 응답 상태코드·에러 JSON 형태는 기존과 100% 동일하게 유지(프런트 폴백이 의존).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAnswers, Answer } from './scoring.js';
import { rateLimit, clientIp } from './ratelimit.js';

export { clientIp };

// 허용 메서드가 아니면 405 응답 후 false.
export function methodGuard(req: VercelRequest, res: VercelResponse, method: string): boolean {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ error: 'method_not_allowed' });
  return false;
}

// 일관 에러 응답 헬퍼.
export function fail(res: VercelResponse, status: number, error: string, extra?: Record<string, unknown>) {
  return res.status(status).json({ error, ...(extra || {}) });
}

// rate limit 초과 시 429 응답 후 false.
export function enforceRateLimit(res: VercelResponse, key: string, limit: number, windowMs: number): boolean {
  if (rateLimit(key, limit, windowMs)) return true;
  res.status(429).json({ error: 'rate_limited' });
  return false;
}

// answers 검증 실패 시 400 응답 후 null.
export function readAnswers(res: VercelResponse, raw: unknown): Answer[] | null {
  try {
    return validateAnswers(raw);
  } catch (e) {
    res.status(400).json({ error: 'invalid_answers', detail: (e as Error).message });
    return null;
  }
}
