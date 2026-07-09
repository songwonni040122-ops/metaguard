import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { dbEnabled, insertReturning } from './_lib/supabase.js';
import { methodGuard } from './_lib/http.js';
import { LIMITS } from './_lib/limits.js';

// POST /api/session — 익명 세션 발급. DB 미설정이어도 로컬 uuid 로 동작.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, 'POST')) return;

  const body = (req.body || {}) as { soldierName?: unknown };
  let soldierName: string | null = null;
  if (typeof body.soldierName === 'string') {
    soldierName = body.soldierName.trim().slice(0, LIMITS.soldierNameMax) || null;
  }

  let sessionId = randomUUID();
  if (dbEnabled) {
    try {
      const row = await insertReturning<{ id: string }>('sessions', { soldier_name: soldierName });
      sessionId = row.id;
    } catch (e) {
      // DB 실패해도 익명 세션은 발급 (로그만).
      console.error('session insert failed:', (e as Error).message);
    }
  }

  return res.status(200).json({ sessionId });
}
