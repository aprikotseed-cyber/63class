// 파일을 고친 뒤 실행하면 index.html·js 파일·version.json의 ?v=버전을 한꺼번에 새로 바꿔요.
// 휴대폰·태블릿 브라우저가 예전 파일을 붙잡고 있지 않게 하려는 것이에요.
//   npm run bump
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const old = JSON.parse(readFileSync(new URL('version.json', root), 'utf8')).version;
const d = new Date();
const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
// 같은 날 여러 번 올리면 a → b → c ...
const next = old.startsWith(today) ? today + String.fromCharCode(old.charCodeAt(8) + 1) : today + 'a';

// 시험 기간에는 새 구조 입구가 beta.html
const entry = existsSync(new URL('beta.html', root)) ? 'beta.html' : 'index.html';
const files = [entry, ...readdirSync(new URL('js/', root)).map((f) => `js/${f}`)];
for (const f of files) {
  const url = new URL(f, root);
  const s = readFileSync(url, 'utf8');
  const t = s.replaceAll(`?v=${old}`, `?v=${next}`);
  if (s !== t) writeFileSync(url, t);
}
writeFileSync(new URL('version.json', root), `{ "version": "${next}" }\n`);
console.log(`${old} → ${next}`);
