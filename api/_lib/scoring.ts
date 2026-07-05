// 프론트 index.html의 AXES / choiceAxes / TYPES / score() 를 그대로 이식.
// 클라이언트가 보낸 typeCode 는 신뢰하지 않고, 서버가 answers 로 재계산한다.

export type Choice = 'A' | 'B' | 'C' | 'D';
export interface Answer { choice: Choice; }
export type AxisKey = 'info' | 'emo' | 'act' | 'resp';

export const AXES = [
  { key: 'info', label: '정보 처리', strong: { code: 'V', name: '검증형' }, weak: { code: 'A', name: '수용형' } },
  { key: 'emo',  label: '감정 반응', strong: { code: 'S', name: '안정형' }, weak: { code: 'R', name: '동요형' } },
  { key: 'act',  label: '행동 순위', strong: { code: 'M', name: '임무중심' }, weak: { code: 'P', name: '개인중심' } },
  { key: 'resp', label: '대응 방식', strong: { code: 'C', name: '능동형' }, weak: { code: 'W', name: '회피형' } },
] as const;

export const choiceAxes: Record<Choice, Record<AxisKey, string>> = {
  A: { info: 'V', emo: 'S', act: 'M', resp: 'C' },
  B: { info: 'A', emo: 'S', act: 'P', resp: 'W' },
  C: { info: 'A', emo: 'R', act: 'P', resp: 'W' },
  D: { info: 'A', emo: 'R', act: 'P', resp: 'C' },
};

export const TYPES: Record<string, { name: string; trait: string; tag: string }> = {
  VSMC: { name: '철벽 방패형', trait: '검증·냉정·임무중심·능동대응을 모두 갖춘, 인지전에 가장 이상적인 정신전력 유형이에요.', tag: '이상적인 정신전력 유형' },
  VSMW: { name: '신중 관망형', trait: '정확히 판단하지만 적극적인 신고·대응에는 다소 소극적인 편이에요.', tag: '' },
  VSPC: { name: '분석 행동형', trait: '검증하고 냉정하지만 판단의 무게가 부대보다 개인에 치우쳐 있어요.', tag: '' },
  VSPW: { name: '냉철 고립형', trait: '흔들리지 않지만 혼자만 알고 공유하지 않는 경향이 있어요.', tag: '' },
  VRMC: { name: '열혈 검증형', trait: '의심과 대응은 빠르지만 감정이 앞서 나가는 편이에요.', tag: '' },
  VRMW: { name: '불안 검증형', trait: '진위는 따지지만 정서 동요로 위축되어 대응이 늦어질 수 있어요.', tag: '' },
  VRPC: { name: '충동 폭로형', trait: '검증은 하지만 감정적으로 과잉 확산시키는 경향이 있어요.', tag: '' },
  VRPW: { name: '회의 불안형', trait: '의심은 많지만 불안해하며 숨는 경향이 있어요.', tag: '' },
  ASMC: { name: '단순 돌격형', trait: '임무엔 충실하지만 정보를 그대로 믿는 경향이 있어요.', tag: '' },
  ASMW: { name: '묵묵 순응형', trait: '안정적이지만 무비판적으로 수용하고 회피하는 편이에요.', tag: '' },
  ASPC: { name: '낙관 전파형', trait: '흔들림은 없지만 검증 없이 정보를 퍼뜨리는 경향이 있어요.', tag: '' },
  ASPW: { name: '무심 방관형', trait: '위협에 둔감해 관심과 대응이 모두 부족한 편이에요.', tag: '' },
  ARMC: { name: '격정 행동형', trait: '임무중심이지만 선동에 쉽게 격앙되는 경향이 있어요.', tag: '' },
  ARMW: { name: '동요 위축형', trait: '가짜정보에 흔들리고 임무에서 이탈할 우려가 있어요.', tag: '' },
  ARPC: { name: '감정 확산형', trait: '미검증 정보를 감정대로 즉시 확산시켜 여론조작에 가장 취약한 유형이에요.', tag: '여론조작에 가장 취약' },
  ARPW: { name: '심리 표류형', trait: '검증·안정·대응이 모두 약해 최우선 보강이 필요한 유형이에요.', tag: '최우선 보강 대상' },
};

const AXIS_BLURB: Record<AxisKey, string> = {
  info: '출처를 확인하기 전에 정보를 그대로 받아들이는 경향(검증 약점)',
  emo:  '선동·공포 자극에 정서가 먼저 흔들리는 경향(감정 약점)',
  act:  '임무·부대보다 개인 감정을 앞세우는 경향(임무우선 약점)',
  resp: '위협을 인지하고도 신고·대응보다 회피하는 경향(대응 약점)',
};

export interface ScoreResult {
  code: string;
  scores: Record<AxisKey, number>;
  weakAxes: AxisKey[];
}

export function score(answers: Answer[]): ScoreResult {
  const tally: Record<AxisKey, Record<string, number>> = { info: {}, emo: {}, act: {}, resp: {} };
  answers.forEach((a) => {
    const ax = choiceAxes[a.choice];
    if (!ax) return;
    (['info', 'emo', 'act', 'resp'] as AxisKey[]).forEach((k) => {
      const l = ax[k];
      tally[k][l] = (tally[k][l] || 0) + 1;
    });
  });
  const n = answers.length || 1;
  const scores = {} as Record<AxisKey, number>;
  let code = '';
  AXES.forEach((axis) => {
    const t = tally[axis.key];
    const s = t[axis.strong.code] || 0;
    const w = t[axis.weak.code] || 0;
    code += s >= w ? axis.strong.code : axis.weak.code;
    scores[axis.key] = Math.round((s / n) * 100);
  });
  const weakAxes = AXES.filter((axis) => {
    const t = tally[axis.key];
    return (t[axis.weak.code] || 0) > (t[axis.strong.code] || 0);
  }).map((a) => a.key as AxisKey);
  return { code, scores, weakAxes };
}

export function typeInfo(code: string): { name: string; trait: string; tag: string } {
  return TYPES[code] || { name: '복합 대응형', trait: '여러 성향이 혼재된 유형이에요.', tag: '' };
}

export function weakAxesText(weakAxes: AxisKey[]): string {
  if (!weakAxes.length) return '네 영역 모두 안정적';
  return weakAxes.map((k) => AXIS_BLURB[k]).join(', ');
}

// 클라이언트 입력을 신뢰하지 않고 검증/정규화한다.
export function validateAnswers(input: unknown): Answer[] {
  if (!Array.isArray(input)) throw new Error('answers must be an array');
  if (input.length === 0 || input.length > 50) throw new Error('answers length out of range');
  return input.map((a: any) => {
    const choice = a && a.choice;
    if (choice !== 'A' && choice !== 'B' && choice !== 'C' && choice !== 'D') {
      throw new Error('invalid choice: ' + String(choice));
    }
    return { choice: choice as Choice };
  });
}
