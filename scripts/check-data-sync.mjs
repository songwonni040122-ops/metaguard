// 클라이언트(public/assets/mg-data.js) ↔ 서버(api/_lib/scoring.ts)의 중복 진단 데이터가
// 어긋나지 않았는지 검사한다. 빌드 없이 설치된 typescript 로 scoring.ts 를 트랜스파일해 비교.
// 불일치 시 비정상 종료(1). 실행: npm run check:data
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 1) 클라이언트 데이터: mg-data.js 를 가짜 window 컨텍스트에서 실행 → window.MG
const mgSrc = readFileSync(join(root, 'public/assets/mg-data.js'), 'utf8');
const winCtx = { window: {} };
vm.createContext(winCtx);
vm.runInContext(mgSrc, winCtx);
const client = winCtx.window.MG || {};

// 2) 서버 데이터: scoring.ts 를 CommonJS 로 트랜스파일 → VM 실행 → exports
const tsSrc = readFileSync(join(root, 'api/_lib/scoring.ts'), 'utf8');
const js = ts.transpileModule(tsSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandbox = { exports: {}, require: () => ({}) };
sandbox.module = { exports: sandbox.exports };
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
const server = sandbox.exports;

// 3) 공유 부분집합 비교
const errors = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (!eq(client.choiceAxes, server.choiceAxes)) errors.push('choiceAxes 불일치');

const axisCore = (arr) => (arr || []).map((x) => ({
  key: x.key, label: x.label,
  sc: x.strong && x.strong.code, sn: x.strong && x.strong.name,
  wc: x.weak && x.weak.code, wn: x.weak && x.weak.name,
}));
if (!eq(axisCore(client.AXES), axisCore(server.AXES))) errors.push('AXES(key/label/강약 코드·이름) 불일치');

const ck = Object.keys(client.TYPES || {}).sort();
const sk = Object.keys(server.TYPES || {}).sort();
if (!eq(ck, sk)) {
  errors.push(`TYPES 키 집합 불일치 (client ${ck.length} vs server ${sk.length})`);
} else {
  for (const k of ck) {
    const c = client.TYPES[k], s = server.TYPES[k];
    if (!s || c.name !== s.name || c.trait !== s.trait || c.tag !== s.tag) errors.push(`TYPES.${k} 불일치`);
  }
}

if (errors.length) {
  console.error('데이터 드리프트 발견 (클라↔서버):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('OK: mg-data.js ↔ scoring.ts 데이터 일치 (choiceAxes, AXES 코드/이름, TYPES ' + ck.length + '종)');
