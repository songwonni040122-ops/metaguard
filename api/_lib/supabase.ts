// Supabase Postgres 접근 (service_role, PostgREST REST).
// 의존성 없이 fetch 사용. 키가 없으면 dbEnabled=false → 호출부에서 best-effort 로 건너뛴다.

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export const dbEnabled = !!(URL_BASE && SERVICE_KEY);

function headers(prefer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

// row 삽입 후 생성된 row 반환.
export async function insertReturning<T = any>(table: string, row: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers('return=representation'),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`supabase insert ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const arr = (await r.json()) as T[];
  return arr[0];
}

// 반환 불필요한 삽입(로그 등). 실패해도 앱 흐름을 막지 않도록 호출부에서 try/catch.
export async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers('return=minimal'),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`supabase insert ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

// 여러 row 삽입 후 생성된 rows 반환(프리셋 시드 등).
export async function insertManyReturning<T = any>(table: string, rows: Record<string, unknown>[]): Promise<T[]> {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers('return=representation'),
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`supabase insertMany ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

// PostgREST 쿼리(예: 'squad_id=eq.<id>&order=sort_idx').
export async function select<T = any>(table: string, query: string): Promise<T[]> {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, { headers: headers() });
  if (!r.ok) throw new Error(`supabase select ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

// filter(예: 'id=eq.<id>')에 해당하는 row 갱신 후 반환.
export async function update<T = any>(table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers('return=representation'),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`supabase update ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

// on_conflict 컬럼 기준 upsert(멤버 재참여 등). 반환 없음.
export async function upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: headers('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`supabase upsert ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
