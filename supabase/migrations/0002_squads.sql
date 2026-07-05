-- 0002_squads.sql — 분대 공유 원칙 + 실시간 채팅 (참여코드 방식)
-- 보안: 읽기(SELECT)만 공개 → 익명 클라이언트가 Realtime 구독 가능.
--        쓰기는 서버(service_role, RLS 우회)만. 클라 직접 쓰기 불가.
--        기존 민감 테이블(sessions/diagnoses/chat_messages/reports)은 계속 전면 차단 유지.

create extension if not exists pgcrypto;

create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists squad_members (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id) on delete cascade,
  session_id uuid,
  name text not null,
  joined_at timestamptz not null default now(),
  unique (squad_id, session_id)
);

create table if not exists squad_principles (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id) on delete cascade,
  text text not null,
  source text not null default 'custom',   -- 'preset' | 'custom'
  enabled boolean not null default true,
  created_by uuid,
  sort_idx int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists squad_messages (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads(id) on delete cascade,
  session_id uuid,
  name text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_squad_members_squad on squad_members(squad_id);
create index if not exists idx_squad_principles_squad on squad_principles(squad_id, sort_idx);
create index if not exists idx_squad_messages_squad on squad_messages(squad_id, created_at);

-- RLS: 읽기만 공개(익명 Realtime 구독용), 쓰기 정책 없음 → 익명 쓰기 차단.
alter table squads enable row level security;
alter table squad_members enable row level security;
alter table squad_principles enable row level security;
alter table squad_messages enable row level security;

create policy "public read squads"     on squads           for select using (true);
create policy "public read members"    on squad_members    for select using (true);
create policy "public read principles" on squad_principles for select using (true);
create policy "public read messages"   on squad_messages   for select using (true);

-- Realtime 송출 등록(postgres_changes).
alter publication supabase_realtime add table squads;
alter publication supabase_realtime add table squad_members;
alter publication supabase_realtime add table squad_principles;
alter publication supabase_realtime add table squad_messages;
