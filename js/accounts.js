// accounts.js — 학생 계정·비밀번호 기록 관리 (공통 기능)
//
// · 학생 비밀번호 기록(선생님이 잊어버린 비밀번호를 알려주거나 바꿀 때 필요)은
//   학생 문서가 아니라 선생님만 읽을 수 있는 studentSecrets/{학생ID} 에 둬요.
//   (예전엔 학생 문서의 pwHint 에 있어서 다른 학생도 읽을 수 있었어요)
// · 선생님 쪽에서 학생 계정으로 로그인해야 할 때는 보조 로그인 창구(getHelperAuth)를 써서
//   선생님 로그인이 풀리지 않게 해요.
import { state } from './state.js?v=20261111d';
import {
  createUserWithEmailAndPassword, db, deleteDoc, deleteField, doc, getDoc, getHelperAuth,
  serverTimestamp, setDoc, signInWithEmailAndPassword, signOut, updateDoc
} from './firebase.js?v=20261111d';
import { makePw, nameToEmail } from './level.js?v=20261111d';

export const SECRETS = 'studentSecrets';

// 학생 비밀번호 기록 읽기: 보관함 우선, 없으면 예전 위치(학생 문서의 pwHint)
export async function getPwHint(studentId) {
  try {
    const snap = await getDoc(doc(db, SECRETS, studentId));
    if (snap.exists() && snap.data().pwHint) return snap.data().pwHint;
  } catch (e) { /* 규칙상 못 읽으면(학생) 예전 위치만 봄 */ }
  return state.students.find((s) => s.id === studentId)?.pwHint || '';
}

// 학생 비밀번호 기록 저장 + 예전 위치(학생 문서)에 남은 기록 지우기
export async function savePwHint(studentId, pw) {
  await setDoc(doc(db, SECRETS, studentId), { pwHint: pw, updatedAt: serverTimestamp() }, { merge: true });
  const s = state.students.find((x) => x.id === studentId);
  if (s && 'pwHint' in s) {
    try { await updateDoc(doc(db, 'students', studentId), { pwHint: deleteField() }); } catch (e) { /* 무시 */ }
  }
}

export async function removePwHint(studentId) {
  try { await deleteDoc(doc(db, SECRETS, studentId)); } catch (e) { /* 무시 */ }
}

// 비밀번호 후보 목록 (예전엔 4~5자리면 뒤에 !! 를 붙여 저장했기 때문에 두 가지 모두 시도)
export function pwCandidates(hints) {
  const out = [];
  for (const h of hints) if (h) for (const p of [makePw(h), h]) if (!out.includes(p)) out.push(p);
  return out;
}

// 보조 창구로 학생 계정에 로그인 (선생님 로그인은 그대로). { user, pw } 또는 { user: null, code }
export async function helperSignInStudent(name, hints) {
  const helper = getHelperAuth();
  const email = nameToEmail(name);
  let code = '';
  for (const pw of pwCandidates(hints)) {
    try {
      const cred = await signInWithEmailAndPassword(helper, email, pw);
      return { user: cred.user, pw };
    } catch (e) {
      code = e.code || '';
      if (code === 'auth/too-many-requests') break;
    }
  }
  return { user: null, code };
}

// 보조 창구로 학생 계정 만들기 (선생님 로그인은 그대로)
export async function helperCreateStudent(name, pw) {
  const cred = await createUserWithEmailAndPassword(getHelperAuth(), nameToEmail(name), makePw(pw));
  return cred.user;
}

export async function helperSignOut() {
  try { await signOut(getHelperAuth()); } catch (e) { /* 무시 */ }
}
