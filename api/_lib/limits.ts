// 입력 길이·rate limit 등 정책 상수 집약. 여기저기 흩어진 리터럴을 한 곳에서 관리.
export const LIMITS = {
  // chat
  chatMessageMax: 500,
  chatHistoryMax: 12,
  maxQuestions: 5,     // 오프닝 1 + 후속 = 총 5개, 이후 프롬프트가 마무리
  // report
  adjustCap: 20,       // 축별 상담 보정 상한(±)
  transcriptMax: 20,   // 보정에 넣는 대화 최대 턴
  // session
  soldierNameMax: 40,
  // squad
  squadNameMax: 24,
  squadTextMax: 200,   // 원칙
  squadMsgMax: 300,    // 채팅
  squadMsgHistory: 200,
} as const;

// rate limit 정책(limit / windowMs).
export const RATE = {
  chat: { limit: 10, windowMs: 60_000 },
  report: { limit: 5, windowMs: 60_000 },
  squad: {
    create: { limit: 5, windowMs: 60_000 },
    join: { limit: 15, windowMs: 60_000 },
    state: { limit: 40, windowMs: 60_000 },
    toggle: { limit: 40, windowMs: 60_000 },
    add: { limit: 20, windowMs: 60_000 },
    send: { limit: 20, windowMs: 60_000 },
  },
} as const;
