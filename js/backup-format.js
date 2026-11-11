// backup-format.js — 백업 파일 형식 (Firebase 없이 동작하는 순수 함수, 테스트 가능)

// 홈페이지가 쓰는 Firestore 컬렉션 전체 목록.
// 새 컬렉션을 쓰기 시작하면 여기에도 추가해야 해요 (tests/backup.test.mjs가 빠진 걸 알려줘요).
export const BACKUP_COLLECTIONS = [
  'students', 'config', 'history', 'exchanges', 'notifications', 'givenCards', 'roleLogs',
  'rewards', 'messages', 'titleInventory', 'crowdfunding', 'boardPosts', 'roleAuctions',
  'bookWeeks', 'studentLogs', 'roles', 'checkTableRows', 'frameInventory', 'roleRewardBatches',
  'checkTables', 'attendance', 'crowdfundingLogs', 'checkTableCardLog', 'titles', 'titleDeleted',
  'studentLogsDeleted', 'praiseCards', 'petInventory', 'boardComments', 'roleBids', 'profileMsgLog',
  'frameDeleted', 'bookCardLog', 'avatarInventory', 'cardSubTabs', 'studentSecrets',
];

// Firestore 값(Timestamp 등)을 JSON으로 저장할 수 있는 형태로 바꿔요.
export function toPlain(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v.toDate === 'function' && typeof v.seconds === 'number') {
    return { __type: 'timestamp', seconds: v.seconds, nanoseconds: v.nanoseconds ?? 0, iso: v.toDate().toISOString() };
  }
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) {
    return { __type: 'geopoint', latitude: v.latitude, longitude: v.longitude };
  }
  if (typeof v.path === 'string' && v.firestore) return { __type: 'ref', path: v.path };
  if (typeof v.toBase64 === 'function') return { __type: 'bytes', base64: v.toBase64() };
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = toPlain(x);
  return out;
}

// 백업 파일 내용 만들기. collections: { 이름: [{id, data}] }
export function makeBackup(collections, { version = '', now = new Date(), errors = {} } = {}) {
  const body = {};
  const counts = {};
  for (const [name, docs] of Object.entries(collections)) {
    body[name] = {};
    for (const d of docs) body[name][d.id] = toPlain(d.data);
    counts[name] = docs.length;
  }
  return {
    app: '육삼레벨업',
    kind: 'firestore-backup',
    exportedAt: now.toISOString(),
    version,
    counts,
    totalDocs: Object.values(counts).reduce((a, b) => a + b, 0),
    errors,
    collections: body,
  };
}

export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `63levelup-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}
