import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as acorn from 'acorn';

// 화면의 onclick="함수()" 같은 버튼은 window에 등록된 함수만 부를 수 있어요.
// 모듈 안 함수를 그냥 부르면 "is not defined" 오류로 버튼이 먹통이 돼요.
const root = new URL('../', import.meta.url);
const jsFiles = readdirSync(new URL('js/', root)).map((f) => readFileSync(new URL(`js/${f}`, root), 'utf8'));
const html = readFileSync(new URL('index.html', root), 'utf8');

const onWindow = new Set();
const declared = new Set();
for (const src of jsFiles) {
  for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) onWindow.add(m[1]);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const n of ast.body) {
    const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
    if (d?.type === 'FunctionDeclaration') declared.add(d.id.name);
  }
}
const BUILTIN = new Set(['alert', 'confirm', 'prompt', 'setTimeout', 'clearTimeout', 'parseInt', 'parseFloat', 'Number', 'String', 'Math', 'event', 'open', 'print', 'encodeURIComponent', 'decodeURIComponent', 'isNaN', 'requestAnimationFrame', 'fetch', 'navigator', 'location', 'history', 'document', 'window', 'console', 'JSON', 'Date', 'Object', 'Array', 'Boolean']);
const KEYWORDS = new Set(['if', 'return', 'function', 'typeof', 'new', 'await', 'async', 'for', 'while', 'switch', 'catch']);

function handlerCalls(text) {
  const calls = [];
  for (const m of text.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
    // '...' 와 `...` 안(스타일 값, 메시지 등)은 빼고 함수 호출만 찾기
    const code = m[1].replace(/\\'/g, "'").replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``').replace(/\$\{[^}]*\}/g, '0');
    for (const c of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.push(c[1]);
  }
  return calls;
}

test('화면 버튼(onclick 등)이 부르는 함수가 모두 window에 등록되어 있다', () => {
  const missing = new Set();
  for (const text of [html, ...jsFiles]) {
    for (const name of handlerCalls(text)) {
      if (onWindow.has(name) || BUILTIN.has(name) || KEYWORDS.has(name)) continue;
      missing.add(declared.has(name) ? `${name} (모듈 안에만 있음 → window.${name} = ${name} 필요)` : `${name} (어디에도 없음)`);
    }
  }
  assert.deepEqual([...missing], []);
});
