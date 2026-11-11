import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { BACKUP_COLLECTIONS, toPlain, makeBackup, backupFileName } from '../js/backup-format.js';

test('코드에서 쓰는 모든 Firestore 컬렉션이 백업 목록에 있다', () => {
  const dir = new URL('../js/', import.meta.url);
  const used = new Set();
  for (const f of readdirSync(dir)) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    for (const m of s.matchAll(/(?:collection|doc)\(db,\s*['`]([A-Za-z_]+)['`/]/g)) used.add(m[1]);
  }
  const missing = [...used].filter((c) => !BACKUP_COLLECTIONS.includes(c));
  assert.deepEqual(missing, [], '백업 목록(js/backup-format.js)에 추가해 주세요');
});

test('Timestamp 등 Firestore 값을 JSON으로 바꾼다', () => {
  const ts = { seconds: 1700000000, nanoseconds: 5, toDate: () => new Date(1700000000000) };
  const out = toPlain({ a: 1, b: 'x', c: null, d: [ts, { e: ts }], f: { g: true } });
  assert.deepEqual(out, {
    a: 1, b: 'x', c: null,
    d: [{ __type: 'timestamp', seconds: 1700000000, nanoseconds: 5, iso: '2023-11-14T22:13:20.000Z' },
      { e: { __type: 'timestamp', seconds: 1700000000, nanoseconds: 5, iso: '2023-11-14T22:13:20.000Z' } }],
    f: { g: true },
  });
  JSON.stringify(out);
});

test('백업 파일에 컬렉션별 문서 수와 오류가 기록된다', () => {
  const b = makeBackup({ students: [{ id: 's1', data: { name: '가' } }, { id: 's2', data: { name: '나' } }], roles: [] },
    { version: 'v1', now: new Date('2026-11-11T06:30:00Z'), errors: { roles: 'permission-denied' } });
  assert.equal(b.totalDocs, 2);
  assert.deepEqual(b.counts, { students: 2, roles: 0 });
  assert.deepEqual(b.collections.students.s2, { name: '나' });
  assert.equal(b.errors.roles, 'permission-denied');
  assert.match(backupFileName(new Date(2026, 10, 11, 9, 5)), /^63levelup-backup-2026-11-11-0905\.json$/);
});
