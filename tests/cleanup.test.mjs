import test from 'node:test';
import assert from 'node:assert/strict';
import { planOrphans, oldReadNotifications, countByCol, chunk } from '../js/cleanup-plan.js';

const students = [{ id: 'new1', name: '김하나' }, { id: 's2', name: '이두리' }, { id: 'a', name: '쌍둥이' }, { id: 'b', name: '쌍둥이' }];

test('지금 있는 학생의 기록은 건드리지 않는다', () => {
  const r = planOrphans({ history: [{ id: 'h1', data: { studentId: 's2', studentName: '이두리' } }] }, students);
  assert.deepEqual(r, { relink: [], remove: [] });
});

test('계정 재생성으로 끊긴 기록은 같은 이름 학생에게 다시 연결한다', () => {
  const r = planOrphans({ givenCards: [{ id: 'g1', data: { studentId: 'old1', studentName: '김하나' } }] }, students);
  assert.deepEqual(r.relink, [{ col: 'givenCards', id: 'g1', from: 'old1', to: 'new1', name: '김하나' }]);
  assert.deepEqual(r.remove, []);
});

test('삭제된 학생의 기록은 삭제 대상, 같은 이름이 2명이면 연결하지 않고 삭제 대상', () => {
  const r = planOrphans({
    history: [{ id: 'h1', data: { studentId: 'gone', studentName: '전학간학생' } }, { id: 'h2', data: { studentId: 'x', studentName: '쌍둥이' } }],
  }, students);
  assert.deepEqual(r.relink, []);
  assert.deepEqual(r.remove.map((x) => x.id), ['h1', 'h2']);
});

test('studentId가 없거나 선생님 것이면 건드리지 않는다', () => {
  const r = planOrphans({ messages: [{ id: 'm1', data: { studentId: 'teacher' } }, { id: 'm2', data: {} }] }, students);
  assert.deepEqual(r, { relink: [], remove: [] });
});

test('읽은 지 30일 지난 알림만 고른다', () => {
  const now = Date.UTC(2026, 10, 11);
  const day = 86400;
  const docs = [
    { id: 'old-read', data: { read: true, createdAt: { seconds: now / 1000 - 40 * day } } },
    { id: 'old-unread', data: { read: false, createdAt: { seconds: now / 1000 - 40 * day } } },
    { id: 'new-read', data: { read: true, createdAt: { seconds: now / 1000 - 3 * day } } },
    { id: 'no-date', data: { read: true } },
  ];
  assert.deepEqual(oldReadNotifications(docs, now), ['old-read']);
});

test('묶음 나누기와 개수 세기', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(countByCol([{ col: 'a' }, { col: 'b' }, { col: 'a' }]), { a: 2, b: 1 });
});
