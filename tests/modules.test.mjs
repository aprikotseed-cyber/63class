import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as acorn from 'acorn';

// js/ 파일들이 서로 주고받는 이름(import/export)이 맞는지 확인해요.
// 브라우저에서 "does not provide an export named ..." 오류로 화면이 통째로 안 뜨는 걸 미리 막아요.
const dir = new URL('../js/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const parsed = Object.fromEntries(files.map((f) => [f, acorn.parse(readFileSync(new URL(f, dir), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })]));

function exportsOf(ast) {
  const names = new Set();
  for (const n of ast.body) {
    if (n.type !== 'ExportNamedDeclaration') continue;
    if (n.declaration?.id) names.add(n.declaration.id.name);
    for (const d of n.declaration?.declarations ?? []) names.add(d.id.name);
    for (const s of n.specifiers) names.add(s.exported.name);
  }
  return names;
}

test('모든 js 파일이 문법 오류 없이 읽힌다', () => {
  assert.ok(files.length > 10);
});

test('import 하는 이름이 상대 파일에 실제로 export 되어 있다', () => {
  for (const [f, ast] of Object.entries(parsed)) {
    for (const n of ast.body) {
      if (n.type !== 'ImportDeclaration' || !n.source.value.startsWith('./')) continue;
      const target = n.source.value.slice(2).split('?')[0];
      assert.ok(parsed[target], `${f}: ${target} 파일이 없어요`);
      const ex = exportsOf(parsed[target]);
      for (const s of n.specifiers) assert.ok(ex.has(s.imported.name), `${f}: ${target}에 ${s.imported.name} export가 없어요`);
    }
  }
});

test('app.js가 모든 기능 파일을 불러온다', () => {
  const imported = new Set();
  const visit = (f) => {
    if (imported.has(f)) return;
    imported.add(f);
    for (const n of parsed[f].body) if (n.type === 'ImportDeclaration' && n.source.value.startsWith('./')) visit(n.source.value.slice(2).split('?')[0]);
  };
  visit('app.js');
  assert.deepEqual(files.filter((f) => !imported.has(f)), []);
});

test('같은 window 함수를 두 파일에서 덮어쓰지 않는다', () => {
  const seen = new Map();
  for (const [f, ast] of Object.entries(parsed)) {
    for (const n of ast.body) {
      const e = n.type === 'ExpressionStatement' && n.expression;
      if (e?.type !== 'AssignmentExpression' || e.left.object?.name !== 'window' || !/Function/.test(e.right.type)) continue;
      const name = e.left.property.name;
      assert.ok(!seen.has(name), `window.${name}: ${seen.get(name)}와 ${f}`);
      seen.set(name, f);
    }
  }
});
