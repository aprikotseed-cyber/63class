// dungeon-run.js — 던전 "오늘의 도전 기회"를 서버(Firestore)에서 관리
//
// 예전엔 전투가 끝날 때만 기록해서, 지고 있을 때 새로고침·다른 메뉴로 나갔다 오기·창 여러 개로
// 다시 도전하거나 보상을 두 번 받을 수 있었어요. 이제는:
//  1) 전투를 시작하는 순간 기회를 먼저 사용 처리(claim) — 학생 문서의 날짜 + 이번 도전 번호(run)
//  2) 첫 공격 때 "사용함(used)" 표시 — 그 뒤로는 나가도 기회가 돌아오지 않아요
//  3) 공격 전에 나가면(새로고침 포함) 기회를 돌려줘요(release) — 아무것도 얻은 게 없으니까요
//  4) 보상은 이번 도전 번호가 맞고 아직 안 받았을 때만 한 번 (트랜잭션)
import { state } from './state.js?v=20261120a';
import { auth, db, deleteField, doc, runTransaction } from './firebase.js?v=20261120a';
import { getTodayStr } from './attendance.js?v=20261120a';

// 선생님의 "학생 뷰": 학생 데이터가 없는 연습 모드 — 기회·보상·보스 체력 등 실제 데이터를 쓰지 않아요
export const isPreview = () => auth.currentUser?.email === 'teacher@ourclass.kr';

export const RUN_FIELD = { solo: 'dungeonSoloRun', challenge: 'dungeonChallengeRun', raid: 'dungeonRaidRun' };
export const DATE_FIELD = { solo: 'dungeonSoloDate', challenge: 'dungeonChallengeDate', raid: 'dungeonRaidDate' };

const meRef = () => doc(db, 'students', state.currentUser.uid);
const newRunId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function patchLocal(update) {
  const me = state.students.find((s) => s.id === state.currentUser?.uid);
  if (!me) return;
  for (const [k, v] of Object.entries(update)) {
    if (k.includes('.')) continue;
    if (v && typeof v === 'object' && v.constructor?.name?.includes('FieldValue')) delete me[k];
    else me[k] = v;
  }
}

// 기회 선점: 오늘 이미 썼으면 null, 아니면 이번 도전 번호
export async function claimRun(kind) {
  if (isPreview()) return 'preview-' + newRunId();
  const today = getTodayStr();
  const id = newRunId();
  const update = await runTransaction(db, async (tx) => {
    const snap = await tx.get(meRef());
    const d = snap.exists() ? snap.data() : {};
    if (d[DATE_FIELD[kind]] === today) return null;
    const u = {
      [DATE_FIELD[kind]]: today,
      [RUN_FIELD[kind]]: { id, date: today, prevDate: d[DATE_FIELD[kind]] ?? null, used: false, rewarded: false },
    };
    tx.update(meRef(), u);
    return u;
  });
  if (!update) return null;
  patchLocal(update);
  return id;
}

// 첫 공격: 이 도전을 "사용함"으로 (그 뒤엔 나가도 기회가 돌아오지 않음)
export async function markRunUsed(kind, runId) {
  if (isPreview()) return true;
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(meRef());
    const run = snap.data()?.[RUN_FIELD[kind]];
    if (!run || run.id !== runId) return false; // 다른 창에서 새 도전을 시작함 → 이 전투는 무효
    if (!run.used) tx.update(meRef(), { [`${RUN_FIELD[kind]}.used`]: true });
    return true;
  });
}

// 공격 전에 나감: 기회 돌려주기 (runId 를 주면 그 도전일 때만)
export async function releaseRun(kind, runId) {
  if (isPreview()) return false;
  const today = getTodayStr();
  const update = await runTransaction(db, async (tx) => {
    const snap = await tx.get(meRef());
    const d = snap.exists() ? snap.data() : {};
    const run = d[RUN_FIELD[kind]];
    if (!run || run.date !== today || run.used || run.rewarded) return null;
    if (runId && run.id !== runId) return null;
    if (d[DATE_FIELD[kind]] !== today) return null;
    const u = { [DATE_FIELD[kind]]: run.prevDate ?? null, [RUN_FIELD[kind]]: deleteField() };
    tx.update(meRef(), u);
    return u;
  });
  if (update) patchLocal(update);
  return !!update;
}

// 보상: 이번 도전이 맞고 아직 안 받았을 때만. buildUpdate(학생데이터) 가 돌려준 내용을 함께 저장.
// 성공하면 buildUpdate 가 돌려준 값을, 아니면 null 을 돌려줘요.
export async function rewardRun(kind, runId, buildUpdate) {
  if (isPreview()) return { ...(buildUpdate({}).info || {}), preview: true }; // 연습: 저장 안 함
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(meRef());
    const d = snap.exists() ? snap.data() : {};
    const run = d[RUN_FIELD[kind]];
    if (!run || run.id !== runId || run.rewarded) return null;
    const { update, info } = buildUpdate(d);
    tx.update(meRef(), { ...update, [`${RUN_FIELD[kind]}.rewarded`]: true, [`${RUN_FIELD[kind]}.used`]: true });
    return info ?? true;
  });
}

// 로비에 들어올 때: 이 화면에서 진행 중인 전투가 없는데 "선점만 하고 공격 안 한" 기회가 있으면 돌려줘요
// (공격 전에 새로고침하거나 창을 닫은 경우)
export async function releaseStaleRuns(activeRunIds = []) {
  if (isPreview()) return;
  const me = state.students.find((s) => s.id === state.currentUser?.uid);
  if (!me) return;
  const today = getTodayStr();
  for (const kind of Object.keys(RUN_FIELD)) {
    const run = me[RUN_FIELD[kind]];
    if (run && run.date === today && !run.used && !run.rewarded && !activeRunIds.includes(run.id)) {
      try { await releaseRun(kind, run.id); } catch (e) { /* 무시 */ }
    }
  }
}
