# MetaGuard 웹앱 배포 & AI 구성 설계서 (v2 — 결정 반영)

> 목표: 현재 standalone HTML 프로토타입을 **모바일 웹앱(PWA)** 으로 Vercel에 배포하고,
> 가짜(규칙기반) "AI"를 **OpenAI API 기반 실제 AI**로 교체한다.
> AI 적용 범위: **① QA 챗봇 ② 리포트 해설** 2곳.

## 확정된 결정 (v2)

| 항목 | 결정 |
|---|---|
| 정적 호스팅 | **Vercel** (`*.vercel.app` 도메인 사용) |
| AI 프록시 컴퓨팅 | **Vercel Serverless Functions (`/api/*`)** — 프론트와 동일 도메인(무CORS) |
| 데이터 저장 | **Supabase Postgres** (Vercel 함수에서 service_role로 접근) |
| 대화 로그 | **저장함** (개인정보 고지 + 익명 전제, 10장 참고) |
| OpenAI 모델 | **gpt-5.4-nano** (챗봇·리포트 공통) — `OPENAI_REASONING_EFFORT=none`. `gpt-5.5-nano`는 실존하지 않아 교체됨 |
| 사용자 인증 | **완전 익명** (로그인 없음, 익명 세션 id만) |
| 도메인 | Vercel 제공 도메인 |

> 참고: 원래 "Supabase 중심"으로 논의했으나 호스팅이 Vercel로 확정되어, **컴퓨팅은 Vercel `/api`,
> 저장은 Supabase**로 나누는 것이 가장 단순·안전하다. Edge Function을 굳이 Supabase에 두려면
> `/api` 대신 `supabase/functions/`로 옮기고 프론트에 CORS·anon key만 추가하면 되지만, 이점이 없다.

---

## 1. 현재 상태 요약 (무엇을 바꾸나)

| 화면 | 현재 구현 | 교체 후 |
|---|---|---|
| AI QA 챗봇 (`qaSend`, 955줄) | 정규식 키워드 매칭 → 미리 써둔 답변, `setTimeout` 타이핑 흉내 | OpenAI 스트리밍 (`POST /api/chat`) |
| AI 분석 (`analyzing`, `qaFinish` 970줄) | `setTimeout(2300)` 로딩 연출만 | 실제 `POST /api/report` 대기 |
| 리포트/16유형 판정 (`score()`) | 결정론적 계산 | **그대로 유지**(척추), AI는 해설 문장만 |

**핵심 원칙**: 16유형 판정은 계산식으로 고정, AI에게는 "말(공감·해설·코칭)"만 맡긴다.
→ 결과가 안 흔들리고(할루시네이션 방지), 저렴하며, 규칙기반 코드를 **오프라인 폴백**으로 재활용.

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────┐
│  모바일 브라우저 = MetaGuard PWA               │
│  Vercel에서 서빙되는 정적 파일 (같은 도메인)     │
│  - index.html / sw.js / manifest              │
│  - 키·시크릿 없음                              │
└───────────────┬─────────────────────────────┘
                │ 같은 오리진 fetch (CORS 불필요)
                ▼
┌─────────────────────────────────────────────┐
│  Vercel Serverless Functions (/api)           │
│  - /api/session : 익명 세션 발급               │
│  - /api/chat    : 챗봇 프록시 (스트리밍)        │
│  - /api/report  : 리포트 해설 (JSON)           │
│  - env: OPENAI_API_KEY, SUPABASE_SERVICE_KEY  │
│  - Rate limit / 입력검증 / score 재계산        │
└──────┬───────────────────────┬───────────────┘
       │                       │
       ▼                       ▼
┌──────────────┐      ┌──────────────────┐
│ OpenAI API   │      │ Supabase Postgres │
│ gpt-5.4-nano │      │ sessions/diagnoses│
└──────────────┘      │ /messages/reports │
                      └──────────────────┘
```

모든 비밀키는 **Vercel Environment Variables**에만 존재. 브라우저는 어떤 키도 갖지 않는다.

---

## 3. 프로젝트 구조 (Vercel 기준)

```
metaguard/
├─ public/                       # 정적 자산 (Vercel이 그대로 서빙)
│  ├─ index.html                 # standalone에서 로직 추출 (초기엔 그대로 가능)
│  ├─ manifest.webmanifest
│  ├─ sw.js                      # 서비스워커 (앱 셸·이미지 오프라인 캐시)
│  ├─ icons/                     # 192/512 아이콘 (방패 로고)
│  └─ assets/scen/               # 시나리오 이미지 9장 (base64 번들 대신 분리)
│
├─ api/                          # Vercel Serverless Functions
│  ├─ session.ts                 # POST: 익명 세션 생성
│  ├─ chat.ts                    # POST: 챗봇 스트리밍
│  ├─ report.ts                  # POST: 리포트 해설
│  └─ _lib/
│     ├─ openai.ts               # OpenAI 호출 래퍼 (gpt-5.4-nano)
│     ├─ supabase.ts             # service_role 클라이언트
│     ├─ scoring.ts              # 프론트 score() 이식 → 서버 재계산/검증
│     ├─ prompts.ts              # 시스템 프롬프트 (6장)
│     └─ ratelimit.ts
│
├─ supabase/
│  └─ migrations/0001_init.sql   # 테이블 정의 (DB만 Supabase 사용)
│
├─ vercel.json                   # 함수 런타임/스트리밍 설정
└─ DESIGN.md
```

> `scoring.ts`는 프론트의 `AXES / choiceAxes / score()`를 그대로 복제.
> 클라이언트가 보낸 `typeCode`는 **신뢰하지 말고 서버에서 answers로 재계산**한다.

---

## 4. 데이터 모델 (Supabase Postgres) — 로그 저장 반영

```sql
-- 0001_init.sql
create extension if not exists pgcrypto;

-- 익명 세션 (로그인 없이)
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  soldier_name text,                 -- 화면 표시용 별칭(선택)
  ua_hash      text                  -- 대략적 기기 구분(개인식별 아님, 선택)
);

-- 진단 결과
create table diagnoses (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  answers     jsonb not null,        -- [{choice:'A'}, ...]
  type_code   text  not null,        -- 서버 재계산 값
  scores      jsonb not null,        -- {info:80, emo:40, ...}
  phase       text default 'diag',   -- diag | rediag
  created_at  timestamptz not null default now()
);

-- 챗봇 대화 로그 (저장하기로 확정)
create table chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  role        text not null,         -- 'user' | 'assistant'
  content     text not null,
  turn        int,
  created_at  timestamptz not null default now()
);

-- AI 생성 리포트 (캐시·재현)
create table reports (
  id           uuid primary key default gen_random_uuid(),
  diagnosis_id uuid references diagnoses(id) on delete cascade,
  narrative    jsonb not null,       -- {summary, strengths, weaknesses, coaching[]}
  model        text default 'gpt-5.5-nano',
  created_at   timestamptz not null default now()
);

-- 조회 최적화
create index on diagnoses(session_id);
create index on chat_messages(session_id);
```

### 접근 방침 (익명 + 저장)
- 클라이언트는 **DB에 직접 접근하지 않는다.** 모든 읽기/쓰기는 Vercel 함수가 `service_role`로 수행.
- 따라서 RLS는 전면 차단으로 두고 anon 노출 없음 (service_role은 RLS 우회).
- 익명이지만 `sessions.id`를 `localStorage`에 보관해 재방문·성장추적 연결.

---

## 5. API 명세 (같은 도메인, CORS 불필요)

### 5.1 `POST /api/session`
Request: `{ "soldierName": "고성원" }` (선택)
Response: `{ "sessionId": "uuid" }`
→ 프론트는 최초 진입 시 1회 호출, `localStorage`에 저장.

### 5.2 `POST /api/chat` — QA 챗봇 (스트리밍)
두 가지 모드가 있다.

**(a) 오프닝 모드 `opening:true`** — 진단 완료 직후 첫 질문 생성. 사용자 메시지 없이, 사용자가 실제로 고른 대응(`picks`)을 근거로 AI가 개인화된 첫 질문 1개를 만든다. (기존 정적 `QA_INTROS` 대체)
```json
{
  "sessionId": "uuid",
  "answers": [{"choice":"A"},{"choice":"C"},{"choice":"D"}],
  "opening": true,
  "picks": [{"topic":"동기 김상병 · 1:1 채팅","chose":"일단 넘기고 무시한다"}]
}
```
- `picks`는 서버에서 정규화(최대 12개, topic 80자·chose 120자 제한). 신뢰하지 않음.
- 프롬프트: `openingSystemPrompt(weakAxes, picks)` (6.1). assistant 응답만 `chat_messages`에 `turn 0`으로 저장.
- 실패/오프라인 시 프론트가 규칙기반 정적 인트로(`qaPlan().intro`)로 폴백.

**(b) 대화 모드(기본)** — 사용자 답변에 대한 후속 질문.
```json
{
  "sessionId": "uuid",
  "answers": [{"choice":"A"},{"choice":"C"},{"choice":"D"}],
  "turn": 1,
  "history": [{"role":"assistant","text":"..."},{"role":"user","text":"..."}],
  "message": "사실 좀 불안하긴 했어요"
}
```
서버 처리
1. rate limit 확인 → 초과 시 429 (opening 포함 분당 10회)
2. `scoring.ts`로 answers 재계산 → `weakAxes`
3. 모드별 시스템 프롬프트(6.1) + (대화 모드는 history + 새 메시지)로 **gpt-5.4-nano 스트리밍** 호출
4. SSE(text/event-stream)로 프론트에 델타 전달
5. 메시지를 `chat_messages`에 저장(저장 결정) — 반드시 `res.end()` 전에 await

Response `text/event-stream`
```
data: {"delta":"그 "}
data: {"delta":"불안 "}
data: {"done":true}
```
- 대화 턴 수 하드 캡 없음. 질문 한도(`MAX_QUESTIONS=5`) 도달 시 프롬프트가 자연스럽게 마무리 유도.

### 5.3 `POST /api/report` — 리포트 해설 (JSON)
Request: `{ "sessionId":"uuid", "answers":[...], "phase":"diag" }`
서버 처리
1. rate limit
2. `scoring.ts` 재계산 → `typeCode/scores/weakAxes` (클라 값 무시)
3. `diagnoses` 저장
4. gpt-5.4-nano **Structured Outputs(json_schema)** 로 형식 강제 호출
5. `reports` 저장 후 반환

Response
```json
{
  "typeCode":"ARPC",
  "typeName":"감정 확산형",
  "scores":{"info":40,"emo":30,"act":50,"resp":60},
  "narrative":{
    "summary":"당신은 위협을 빠르게 알아채지만, 검증보다 감정이 먼저 반응하는 편입니다.",
    "strengths":["위협 민감도가 높음","동료를 지키려는 동기가 강함"],
    "weaknesses":["미검증 정보를 감정대로 확산할 위험"],
    "coaching":[
      {"axis":"info","tip":"공유 전 3초 멈추고 출처부터 확인"},
      {"axis":"emo","tip":"화가 날수록 '이건 나를 흔들려는 정보인가?' 자문"}
    ]
  }
}
```
> `typeCode/typeName/scores`는 계산값 그대로, `narrative`만 AI 생성.

### 5.4 분대 원칙 — 참여코드 공유 + 실시간 채팅
개인 훈련의 마지막 단계인 "분대 원칙"을 **여러 명이 한 방에서 함께 정하고 실시간으로 토의**하는 기능.

**보안 모델(하이브리드)**: 쓰기는 서버(service_role), 읽기·실시간은 클라(anon).
- **쓰기**(방 생성/참여/토글/원칙추가/채팅)는 전부 `POST /api/squad`(service_role) 경유 → 검증·rateLimit·길이제한
- **읽기·실시간 수신**은 클라가 anon 키로 **Supabase Realtime** 구독(squad 테이블만 RLS `SELECT using(true)`, `squad_id` 필터). Realtime 불가 시 `state` 액션 3초 폴링 폴백
- 민감 테이블(sessions/diagnoses/chat_messages/reports)은 계속 **RLS 전면 차단**

**DB**(`0002_squads.sql`): `squads`(code 6자 unique) / `squad_members`(unique squad+session) / `squad_principles`(source preset|custom, enabled 공유토글, sort_idx) / `squad_messages`. 4개 모두 `supabase_realtime` publication 등록.

**`POST /api/squad`** — `action` 디스패치:
| action | 입력 | 처리 |
|---|---|---|
| `create` | name | 코드 생성(충돌 재시도)+프리셋4 시드+생성자 멤버 → `{squadId,code,members,principles,messages}` |
| `join` | code,name | 코드 조회(404 가능)+멤버 upsert → 상태 반환 |
| `toggle` | code,principleId,enabled | 공유 토글 update |
| `add` | code,text | 커스텀 원칙 insert(sort_idx=max+1) |
| `send` | code,name,text | 채팅 insert(→ Realtime 송출) |
| `state` | code | 폴링 폴백용 members/principles/messages |

- 코드 알파벳: 혼동문자(I,O,0,1,L) 제외. rateLimit·이름 24자·원칙 200자·채팅 300자 제한. DB 미설정 시 `503 db_disabled` → 프론트가 **오프라인 로컬 목업**(혼자 작성)으로 폴백.

**클라 Realtime**: `<script type="module">`이 CDN(`esm.sh/@supabase/supabase-js@2`)으로 client 생성, `window.mgRealtime.{subscribe,load,unsubscribe}` 노출. **npm 빌드 도입 안 함**(M3 제약 준수). 구독 실패 시 false 반환 → 폴링.

### 5.5 `GET /api/config`
클라 Realtime용 공개 설정 `{ supabaseUrl, supabaseAnonKey }` 반환. anon 키는 공개 설계(RLS 보호). env `SUPABASE_ANON_KEY` 우선, 없으면 프로젝트 anon JWT 폴백.

---

## 6. 프롬프트 설계 (초안)

### 6.1 챗봇 시스템 프롬프트
```
너는 'MetaGuard'의 심리 진단 상담관이다. 대한민국 군 장병이 인지전(가짜뉴스·
딥페이크·선동)에 대응하는 판단 습관을 스스로 돌아보도록 돕는다.

[역할]
- 따뜻하고 담백한 상담관 톤. 훈계·평가·지시 금지. 짧게(2~3문장).
- 사용자의 자유서술에 먼저 공감/반영 후, 판단 습관을 드러내는 후속 질문 1개.
- 최대 {maxTurns}개 질문 후 질문을 멈추고 "이제 정밀 분석을 진행할게요"로 마무리.

[반드시]
- 유형명·점수를 절대 언급하지 않는다(리포트에서 공개).
- 의학적·정치적 단정, 특정 진영 옹호 금지. 방법(검증·냉정·신고)에 집중.
- 한국어. 이모지 최소.

[참고 맥락 — 발화에 직접 노출 금지]
- 현재 추정 약점 축: {weakAxes}  (info=검증, emo=감정, act=임무우선, resp=대응)
```
temperature ≈ 0.6.

### 6.1.1 오프닝 시스템 프롬프트 (`openingSystemPrompt`)
진단 완료 직후 첫 질문 생성 전용. 사용자 메시지 없이 `picks`(사용자가 실제로 고른 대응 목록)만 받아,
그 선택 "패턴"에서 읽히는 경향을 1~2문장으로 짚은 뒤 개인화된 열린 질문 1개를 만든다.
```
[지금 할 일 — 상담의 첫 질문 1개 생성]
- 사용자가 고른 대응 중 가장 특징적인 1~2개를 자연스럽게 언급하며 개인화한다.
- 질문은 반드시 1개. 유형명·점수·영어 축코드는 언급 금지.

[사용자의 실제 선택]
  1. [동기 김상병 · 1:1 채팅] → "일단 넘기고 무시한다"
  ...
```
- `picks` 없음/실패 시 프론트가 정적 인트로로 폴백.

### 6.2 리포트 시스템 프롬프트 (Structured Outputs)
```
너는 MetaGuard 리포트 작성자다. 아래 '확정된' 진단 결과를 바꾸지 말고,
장병 본인에게 설명하는 개인 맞춤 해설을 쓴다.

[입력 — 변경 금지]
- 유형: {typeCode} {typeName} — {typeTrait}
- 축별 점수(0~100, 높을수록 강함): {scores}
- 약점 축: {weakAxes}

[출력 규칙]
- summary: 2문장(강점1 + 핵심약점1).
- strengths 2개 / weaknesses 1~2개.
- coaching: 약점 축마다 1개, '공유 전 3초'처럼 즉시 실천 가능한 행동 팁.
- 비난·불안 조장 금지. "고칠 수 있다"는 성장 관점. 한국어.
```
`response_format: { type:"json_schema", json_schema:{…5.3 스키마…} }`.

---

## 7. 프론트엔드 변경점 (최소 침습)

로직 클래스에서 3곳만 교체, 나머지 규칙기반 코드는 **폴백**으로 유지.

```js
// config (파일 상단 1곳) — 같은 도메인이라 base 경로만
const API = '/api';

// 앱 최초 진입: 익명 세션 확보
async ensureSession() {
  let id = localStorage.getItem('mg_session');
  if (!id) {
    const r = await fetch(`${API}/session`, { method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ soldierName: this.props.soldierName }) });
    id = (await r.json()).sessionId;
    localStorage.setItem('mg_session', id);
  }
  this.sessionId = id;
}

// qaSend: 대본 → 스트리밍 fetch (실패 시 기존 qaAck/qaPlan 폴백)
async qaSend() {
  const res = await fetch(`${API}/chat`, { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ sessionId:this.sessionId, answers, turn, history, message:t }) });
  // res.body 스트림을 읽어 델타를 qaMsgs에 누적 렌더
}

// qaFinish → loadReport: 가짜 타이머 → 실제 호출 (실패 시 결정론 리포트 폴백)
async loadReport() {
  this.setState({ view:'analyzing' });
  const r = await fetch(`${API}/report`, { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ sessionId:this.sessionId, answers, phase }) });
  const data = await r.json();
  this.setState({ view:'report', aiReport:data.narrative, typeCode:data.typeCode });
}
```
- `dataReport()`는 `aiReport`가 있으면 AI 문장을, 없으면 기존 텍스트를 바인딩.

### PWA화
- `manifest.webmanifest`: `short_name:"MetaGuard"`, `display:"standalone"`, `theme_color:"#0b1a40"`, 아이콘.
- `sw.js`: 앱 셸 + 시나리오 이미지 캐시(오프라인 진단 가능, AI만 온라인).
- `<head>`에 `<link rel="manifest">` + iOS `apple-mobile-web-app-*` 메타.

---

## 8. 보안 & Rate Limit

- **OPENAI_API_KEY / SUPABASE_SERVICE_KEY**: Vercel 환경변수에만. 프론트·git 노출 금지.
- **Rate limit**: 세션+IP 기준. 예) 챗봇 분당 10·일 100회, 리포트 세션당 3회. 초과 시 429 → 프론트 폴백.
  구현: 초기엔 `rate_hits` 테이블 또는 Vercel KV/Upstash(권장) 카운터.
- **입력 검증**: message 길이 제한(≤500자), answers 형식 검증. 사용자 입력은 항상 user 역할로만(프롬프트 인젝션 방지, 시스템 규칙 우선).
- **비용 상한**: OpenAI 콘솔 usage limit + 알림 설정.

---

## 9. 비용 추정 (산식 — gpt-5.5-nano 현재 단가 대입)

> 모델 단가는 OpenAI 콘솔에서 최종 확인. nano 등급은 최저가 계층이라 대량 트래픽에 적합.

사용자 1명당 대략 토큰
| 호출 | 입력(대략) | 출력(대략) | 횟수 |
|---|---|---|---|
| 챗봇 1턴 | 400~700 | 80~150 | 2~3 |
| 리포트 | 400~600 | 250~400 | 1(재진단 시 2) |

```
사용자 1명 ≈ 입력 2,300 + 출력 710 토큰
1인당 비용 = (in단가×2300 + out단가×710) / 1e6
월 비용 = 1인당 비용 × 월 사용자수
```
nano 등급이면 **1인당 비용이 매우 낮음**(정확 수치는 단가 확정 후 대입).

---

## 10. 개인정보 · 로그 저장 정책 (저장 결정 반영, 군 맥락)

- **완전 익명**: 로그인 없음, 이름은 표시용 별칭만. 부대·개인 특정 정보 수집 금지.
- **대화·진단 저장함** → 반드시:
  - 첫 화면에 **저장/이용 고지**(자기점검 목적, 공식 평가 아님) 및 동의 표시
  - 자유서술은 그대로 저장하되 개인식별 정보는 수집·요구하지 않음
  - **보존기간** 설정(예: 90일 후 자동 삭제 배치) 및 삭제 요청 경로
- 콘텐츠 톤: 특정 정치 진영 언급 배제, "방법론(검증·신고)" 중심.

---

## 11. 배포 절차

**DB (Supabase)**
```bash
# Supabase 프로젝트 생성 후
supabase link --project-ref <ref>
supabase db push          # 0001_init.sql 반영
# service_role key, project url 확보 → Vercel 환경변수로
```

**프론트 + API (Vercel)**
```bash
vercel link
# 환경변수 등록
vercel env add OPENAI_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel deploy --prod       # public/ 정적 + api/ 함수 동시 배포
```
- 배포 후 `*.vercel.app` 도메인에서 모바일 접속 → "홈 화면에 추가"로 웹앱 설치.
- `vercel.json`에서 `/api/chat` 스트리밍(Edge/Node 런타임) 설정.

---

## 12. 로드맵

- **M1 (MVP)**: Vercel 배포 + PWA + `/api/report` + `/api/chat` 스트리밍 + Supabase 저장. 규칙기반 폴백 유지.
- **M2**: rate limit(Upstash) + 비용 상한 + 저장 고지/보존기간 배치.
- **M3**: 성능 최적화 — 이미지를 base64 번들에서 `/assets` 파일로 분리(5.3MB↓), 캐싱.
  **주의: Vite/React 등으로 빌드 전환하지 않는다.** 이 앱은 디자인 툴의 독자 런타임(`text/x-dc`,
  `DCLogic`, `<sc-if>`/`{{ }}`)으로 만들어졌고, 표준 빌드 도구로 옮기려면 UI를 손으로 재작성해야 해
  **디자인이 틀어질 위험**이 있다. 디자인 툴 산출물은 그대로 두고 그 위에 AI 배관만 얹는다.
- **M4 (선택)**: "의심 메시지 붙여넣기 → AI 조작징후 분석" 기능, 다국어.
- **분대 원칙 공유(구현됨)**: 참여코드로 여러 명이 한 방에서 대응원칙을 함께 정하고 실시간 채팅(Supabase Realtime). 5.4 참조. (향후: 채팅 모더레이션/신고, 방 만료·보존정책)

---

## 구현 착수 체크리스트

- [x] `public/`에 현재 앱 추출 + 이미지 분리 + PWA 파일
- [x] `supabase/migrations/0001_init.sql` 작성 _(push 는 배포 시)_
- [x] `api/_lib/` (scoring/openai/supabase/prompts/ratelimit)
- [x] `api/session.ts` `api/chat.ts` `api/report.ts`
- [x] 프론트 3곳 교체(ensureSession/qaSend/loadReport) + 폴백
- [x] AI 오프닝 질문(`opening` 모드) — 진단 선택 기반 첫 질문 AI 생성
- [x] 분대 원칙 공유 + 실시간 채팅 (`0002_squads.sql`, `api/squad.ts`, `api/config.ts`, Realtime)
- [ ] 배포 시 Vercel 환경변수에 `SUPABASE_ANON_KEY` 추가(없으면 config.ts 폴백값 사용)

> 검증 완료: `tsc --noEmit` 통과 · esbuild 3개 핸들러 번들 성공 · scoring 이식 런타임 대조(ACD→ARPC,
> allA→VSMC) · DCLogic 클래스 `node --check` 통과. 남은 것은 키 등록 + 배포뿐.
```
