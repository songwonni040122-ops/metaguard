// 최소 침습 in-memory rate limit (MVP).
// 주의: 서버리스 인스턴스별 메모리라 완벽하지 않다. 정밀 제한은 Upstash/KV 로 승격(DESIGN.md 8·M2).

interface Window { count: number; resetAt: number; }
const store = new Map<string, Window>();

// true = 허용, false = 초과.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = store.get(key);
  if (!cur || now >= cur.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}

export function clientIp(req: { headers: Record<string, unknown> }): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).split(',')[0].trim();
  return 'unknown';
}
