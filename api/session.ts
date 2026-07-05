import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { dbEnabled, insertReturning } from './_lib/supabase.js';

// POST /api/session — 익명 세션 발급. DB 미설정이어도 로컬 uuid 로 동작.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body || {}) as { soldierName?: unknown };
  let soldierName: string | null = null;
  if (typeof body.soldierName === 'string') {
    soldierName = body.soldierName.trim().slice(0, 40) || null;
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
