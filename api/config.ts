import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/config — 클라이언트 Realtime용 공개 설정.
// anon(publishable) 키는 공개 설계이며 RLS로 보호된다(민감 테이블은 전면 차단).
// env 우선, 없으면 프로젝트 anon JWT 폴백(공개 키라 하드코딩 무해).
const ANON_FALLBACK =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhemhnc2Vha3hxeWxsZWlranNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2OTA3ODIsImV4cCI6MjA5ODI2Njc4Mn0.ws2HxbITebFrqaPvqgIcelBL0aDQ6nCKbwFzfXaPYoo';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ANON_FALLBACK;
  res.setHeader('Cache-Control', 'public, max-age=300');
  // 둘 다 있어야 클라가 Realtime 시도, 아니면 폴링 폴백.
  return res.status(200).json({ supabaseUrl, supabaseAnonKey: supabaseUrl ? supabaseAnonKey : '' });
}
