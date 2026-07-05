-- MetaGuard 초기 스키마 (DESIGN.md 4장) — 완전 익명 + 로그 저장.
-- 클라이언트는 DB에 직접 접근하지 않는다. 모든 R/W 는 Vercel 함수가 service_role 로 수행.

create extension if not exists pgcrypto;

-- 익명 세션 (로그인 없이)
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  soldier_name text,                 -- 화면 표시용 별칭(선택)
  ua_hash      text                  -- 대략적 기기 구분(개인식별 아님, 선택)
);

-- 진단 결과
create table if not exists diagnoses (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  answers     jsonb not null,        -- [{choice:'A'}, ...]
  type_code   text  not null,        -- 서버 재계산 값
  scores      jsonb not null,        -- {info:80, emo:40, ...}
  phase       text default 'diag',   -- diag | rediag
  created_at  timestamptz not null default now()
);

-- 챗봇 대화 로그 (저장 확정)
create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  role        text not null,         -- 'user' | 'assistant'
  content     text not null,
  turn        int,
  created_at  timestamptz not null default now()
);

-- AI 생성 리포트 (캐시·재현)
create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  diagnosis_id uuid references diagnoses(id) on delete cascade,
  narrative    jsonb not null,       -- {summary, strengths, weaknesses, coaching[]}
  model        text default 'gpt-5.5-nano',
  created_at   timestamptz not null default now()
);

-- 조회 최적화
create index if not exists diagnoses_session_idx on diagnoses(session_id);
create index if not exists chat_messages_session_idx on chat_messages(session_id);

-- RLS 전면 차단(anon 노출 없음). service_role 은 RLS 를 우회하므로 Vercel 함수는 정상 동작.
alter table sessions       enable row level security;
alter table diagnoses      enable row level security;
alter table chat_messages  enable row level security;
alter table reports        enable row level security;
