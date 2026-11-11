import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// 휴대폰·태블릿이 예전 파일을 붙잡고 있지 않도록 파일 주소 뒤에 ?v=버전을 붙여요.
// 같은 파일이 다른 버전으로 두 번 불러와지지 않게, 모든 곳의 버전과 version.json이 같아야 해요.
// 시험 기간에는 새 구조 입구가 beta.html (index.html은 기존 단일 파일 버전)
const ENTRY = existsSync(new URL('../beta.html', import.meta.url)) ? 'beta.html' : 'index.html';
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('입구 html, js 파일, version.json의 버전이 모두 같다', () => {
  const files = [ENTRY, ...readdirSync(new URL('../js/', import.meta.url)).map((f) => `js/${f}`)].map(read);
  const versions = new Set(files.flatMap((s) => [...s.matchAll(/\.(?:js|css)\?v=([\w-]+)/g)].map((m) => m[1])));
  assert.equal(versions.size, 1, [...versions].join(', '));
  assert.equal(JSON.parse(read('version.json')).version, [...versions][0]);
  for (const s of files.slice(1)) assert.ok(!/from '\.\/[a-z-]+\.js'/.test(s), '버전 없는 import가 있어요');
});
