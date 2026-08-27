#!/usr/bin/env node
/* =====================================================================
   Dotforge 검증 스크립트
   ---------------------------------------------------------------------
   배포/커밋 전에 실행. 두 가지를 자동 검사한다:
     1) <script> 본문의 JS 문법 (new Function으로 파싱)
     2) HTML 태그 균형 (div / aside / main)
   실패하면 종료 코드 1로 끝나 CI/커밋 훅에서 막을 수 있다.

   사용법:  node scripts/validate.js  [파일경로(기본 index.html)]
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
let ok = true;
const fail = (m) => { console.error('  \x1b[31mFAIL\x1b[0m ' + m); ok = false; };
const pass = (m) => console.log('  \x1b[32mOK\x1b[0m   ' + m);

if (!fs.existsSync(file)) { console.error('파일 없음: ' + file); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');

// 1) JS 문법 검사 — 모든 <script> 블록
console.log('› JS 문법');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) fail('<script> 블록을 찾지 못함');
scripts.forEach((body, i) => {
  // 외부 CDN 스크립트(src만 있는 것)는 본문이 비어 걸러짐
  if (!body.trim()) return;
  try { new Function(body); pass(`script #${i + 1} 문법 통과`); }
  catch (e) { fail(`script #${i + 1}: ${e.message}`); }
});

// 2) HTML 태그 균형 — body 내부
console.log('› HTML 태그 균형');
const bodyStart = html.indexOf('<body');
const bodyEnd = html.indexOf('</body>');
const body = bodyStart >= 0 && bodyEnd >= 0 ? html.slice(bodyStart, bodyEnd) : html;
for (const tag of ['div', 'aside', 'main']) {
  const open = (body.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
  const close = (body.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  if (open === close) pass(`${tag}: ${open}/${close}`);
  else fail(`${tag} 불균형: 여는 태그 ${open} vs 닫는 태그 ${close}`);
}

console.log('');
if (ok) { console.log('\x1b[32m✓ 검증 통과\x1b[0m'); process.exit(0); }
else { console.error('\x1b[31m✗ 검증 실패 — 배포하지 마세요\x1b[0m'); process.exit(1); }
