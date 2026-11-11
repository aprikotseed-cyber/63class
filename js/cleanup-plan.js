// cleanup-plan.js — 데이터 정리 계획 세우기 (Firebase 없이 동작하는 순수 함수, 테스트 가능)

// 학생 ID(studentId)로 학생과 연결되는 기록들.
// 누가기록(studentLogs), 게시판, 체크표 행은 학급 기록이라 대상에서 뺐어요.
export const ORPHAN_COLLECTIONS = [
  'history', 'givenCards', 'exchanges', 'attendance', 'notifications', 'roleLogs',
  'titleInventory', 'frameInventory', 'avatarInventory', 'petInventory', 'titleDeleted', 'frameDeleted',
  'bookCardLog', 'checkTableCardLog', 'crowdfundingLogs', 'profileMsgLog', 'messages',
];

const toMs = (t) => (t?.seconds ? t.seconds * 1000 : t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : 0);

// 지금 학생 목록에 없는 학생 ID로 남은 기록 찾기
//  · 기록에 적힌 이름(studentName)과 같은 학생이 지금 딱 1명 있으면 → 그 학생에게 "다시 연결"
//    (계정 재생성 뒤 따라오지 못한 기록이에요)
//  · 그런 학생이 없으면 → 삭제된 학생의 기록이라 "삭제"
// docsByCol: { 컬렉션: [{ id, data }] }, students: [{ id, name }]
export function planOrphans(docsByCol, students) {
  const live = new Set(students.map((s) => s.id));
  const byName = new Map();
  for (const s of students) byName.set(s.name, byName.has(s.name) ? null : s.id); // 같은 이름 2명이면 null
  const relink = [], remove = [];
  for (const [col, docs] of Object.entries(docsByCol)) {
    for (const { id, data } of docs) {
      const sid = data?.studentId;
      if (!sid || sid === 'teacher' || live.has(sid)) continue;
      const target = data.studentName ? byName.get(data.studentName) : undefined;
      if (target) relink.push({ col, id, from: sid, to: target, name: data.studentName });
      else remove.push({ col, id, from: sid, name: data.studentName || '' });
    }
  }
  return { relink, remove };
}

// 읽은 지 오래된 알림: read === true 이고 만든 지 days일이 지난 것
export function oldReadNotifications(docs, now = Date.now(), days = 30) {
  const limitMs = now - days * 86400000;
  return docs.filter(({ data }) => data?.read === true && toMs(data.createdAt) > 0 && toMs(data.createdAt) < limitMs).map(({ id }) => id);
}

// 컬렉션별 개수 요약 { 컬렉션: 개수 }
export function countByCol(items) {
  const out = {};
  for (const it of items) out[it.col] = (out[it.col] || 0) + 1;
  return out;
}

// 여러 건을 한 번에 처리할 때 나누는 크기 (Firestore 한 묶음 최대 500)
export function chunk(arr, size = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
