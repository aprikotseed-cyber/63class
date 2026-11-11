// auth.js — 로그인(교사/학생), 자동 로그아웃, 교사 비밀번호 변경
import { state } from './state.js?v=20261111c';
import {
  EmailAuthProvider, auth, browserSessionPersistence, collection, createUserWithEmailAndPassword, db,
  deleteField, doc, getDoc, getDocs, query, reauthenticateWithCredential, serverTimestamp, setDoc,
  setPersistence, signInWithEmailAndPassword, signOut, updateDoc, updatePassword, where
} from './firebase.js?v=20261111c';
import { getCfgTeacher, showToast } from './core.js?v=20261111c';
import { makePw, nameToEmail } from './level.js?v=20261111c';
import { enterApp } from './enter.js?v=20261111c';

// ===== 로그인 탭 =====
window.switchLoginTab = function(tab, btn) {
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`.login-tab.${tab}-tab`)?.classList.add('active');
  document.getElementById('studentLoginForm').classList.toggle('hidden', tab !== 'student');
  document.getElementById('teacherLoginForm').classList.toggle('hidden', tab !== 'teacher');
  // 디졸브 효과: teacher일 때 ::before 레이어가 페이드인
  const page = document.getElementById('loginPage');
  if (tab === 'teacher') page.classList.add('mode-teacher');
  else page.classList.remove('mode-teacher');
};

// ===== 교사 로그인 =====
window.teacherLogin = async function() {
  const nameInput = document.getElementById('teacherName').value.trim();
  const pw = document.getElementById('teacherPw').value.trim();
  const errEl = document.getElementById('teacherError');
  errEl.style.display = 'none';
  const fail = (msg) => {
    errEl.style.display = 'block';
    errEl.textContent = msg || '아이디 또는 비밀번호가 올바르지 않습니다.';
  };
  try {
    // 1단계: 아이디 확인 (아이디는 비밀이 아니라 config/teacher 에 둬요)
    const cfg = await getCfgTeacher();
    const storedId = cfg.teacherId || 'teacher';
    if (nameInput !== storedId || !pw) return fail();
    // 2단계: 비밀번호는 Firebase 로그인이 직접 확인해요 (비밀번호를 데이터베이스에 저장하지 않음)
    const teacherEmail = 'teacher@ourclass.kr';
    await setPersistence(auth, browserSessionPersistence);
    try {
      await signInWithEmailAndPassword(auth, teacherEmail, makePw(pw));
    } catch(authErr) {
      if (authErr.code === 'auth/too-many-requests') return fail('로그인 시도가 너무 많아 잠시 막혔어요. 5~10분 뒤에 다시 시도해주세요.');
      // 예전 방식 호환 (데이터 정리 전까지만): config 에 예전 비밀번호가 남아 있고 입력값과 같다면,
      // Firebase 계정 비밀번호가 예전 값으로 남아 있을 수 있어 한 번 맞춰 봐요.
      if (!(cfg.password && pw === cfg.password)) return fail();
      let ok = false;
      for (const old of ['0124!!', '0124', pw + '!!', pw]) {
        try {
          const cred = await signInWithEmailAndPassword(auth, teacherEmail, old);
          await updatePassword(cred.user, makePw(pw));
          ok = true;
          break;
        } catch(e2) {}
      }
      if (!ok) {
        // 선생님 계정이 아예 없을 때(처음 설치)만 새로 만들어져요. 이미 있으면 실패합니다.
        try { await createUserWithEmailAndPassword(auth, teacherEmail, makePw(pw)); ok = true; } catch(e3) {}
      }
      if (!ok) return fail();
    }
    state.currentUser = { role: 'teacher', name: '선생님', uid: 'teacher' };
    enterApp();
  } catch(e) {
    console.error(e);
    fail();
  }
};

// ===== 학생 로그인 =====
window.studentLogin = async function() {
  const name = document.getElementById('studentName').value.trim();
  const pw = document.getElementById('studentPw').value.trim();
  const errEl = document.getElementById('studentError');
  errEl.style.display = 'none';
  if (!name || !pw) { errEl.style.display = 'block'; errEl.textContent = '이름과 비밀번호를 입력하세요.'; return; }
  try {
    await setPersistence(auth, browserSessionPersistence);
    // 맞게 입력했는데 "틀렸다"고 나오던 경우를 줄이기 위해, 틀렸다는 답이 오면 몇 가지만 더 시도해요 (최대 3번)
    //  · 예전에 만든 계정 중 4~5자리 비밀번호를 그대로(뒤에 !! 없이) 저장한 경우
    //  · 이름에 띄어쓰기가 섞이거나, 자판에 따라 한글 글자 조합 방식(NFC/NFD)이 달라진 경우
    const tidyName = name.normalize('NFC').replace(/\s+/g, '');
    const attempts = [[name, makePw(pw)]];
    if (makePw(pw) !== pw) attempts.push([name, pw]);
    if (tidyName !== name) attempts.push([tidyName, makePw(pw)]);
    let cred = null, lastErr = null;
    for (const [n, p] of attempts.slice(0, 3)) {
      try { cred = await signInWithEmailAndPassword(auth, nameToEmail(n), p); break; }
      catch (e) {
        lastErr = e;
        if (e.code !== 'auth/invalid-credential' && e.code !== 'auth/wrong-password' && e.code !== 'auth/user-not-found' && e.code !== 'auth/invalid-email') break;
      }
    }
    if (!cred) throw lastErr;
    const authUid = cred.user.uid; // Firebase Auth uid

    // Auth uid로 직접 Firestore 문서 조회 (가장 정확)
    let studentDoc = await getDoc(doc(db, 'students', authUid));

    if (!studentDoc.exists()) {
      // 혹시 이름으로 찾기 (구버전 데이터 호환)
      const snap = await getDocs(query(collection(db, 'students'), where('name', '==', name)));
      if (snap.empty) { await signOut(auth); errEl.style.display = 'block'; errEl.textContent = '학생 정보를 찾을 수 없어요.'; return; }
      studentDoc = snap.docs[0];
      state.currentUser = { role: 'student', name: snap.docs[0].data().name, uid: snap.docs[0].id };
    } else {
      state.currentUser = { role: 'student', name: studentDoc.data().name, uid: authUid };
    }
    // 최종 로그인 일시 저장
    try {
      await updateDoc(doc(db, 'students', state.currentUser.uid), { lastLoginAt: serverTimestamp() });
    } catch(e) {}
    enterApp();
  } catch(e) {
    console.error('학생 로그인 오류 코드:', e.code, e.message);
    errEl.style.display = 'block';
    if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
      errEl.textContent = '비밀번호가 올바르지 않습니다.';
    } else if (e.code === 'auth/user-not-found') {
      errEl.textContent = '등록되지 않은 학생입니다.';
    } else if (e.code === 'auth/too-many-requests') {
      errEl.textContent = '로그인 시도가 너무 많아 잠시 막혔어요. 5~10분 뒤에 다시 시도해주세요. (비밀번호 문제가 아니에요)';
    } else if (e.code === 'auth/network-request-failed') {
      errEl.textContent = '인터넷 연결이 불안정해요. 연결을 확인하고 다시 시도해주세요.';
    } else {
      errEl.textContent = `이름 또는 비밀번호가 올바르지 않습니다. (${e.code || '알 수 없음'})`;
    }
  }
};

// ===== 자동 로그아웃 (8시간) =====
const AUTO_LOGOUT_MS = 8 * 60 * 60 * 1000; // 8시간
let autoLogoutTimer = null;

export function resetAutoLogoutTimer() {
  if (autoLogoutTimer) clearTimeout(autoLogoutTimer);
  autoLogoutTimer = setTimeout(async () => {
    showToast('장시간 미사용으로 자동 로그아웃됩니다.');
    await new Promise(r => setTimeout(r, 1500));
    window.logout();
  }, AUTO_LOGOUT_MS);
}

// 활동 감지 시 타이머 리셋
['click','keydown','touchstart'].forEach(evt => {
  document.addEventListener(evt, resetAutoLogoutTimer, { passive: true });
});

// ===== 교사 비밀번호 변경 =====
window.changeTeacherPassword = async function() {
  const current = document.getElementById('currentPw').value.trim();
  const newId = document.getElementById('newTeacherId').value.trim();
  const newPw = document.getElementById('newPw').value.trim();
  const confirm2 = document.getElementById('confirmPw').value.trim();
  if (!newId && !newPw) return showToast('변경할 내용을 입력하세요');
  if (!current) return showToast('현재 비밀번호를 입력하세요');
  if (newPw && newPw !== confirm2) return showToast('새 비밀번호가 일치하지 않아요');
  if (newPw && newPw.length < 4) return showToast('비밀번호는 4자리 이상이어야 해요');
  const user = auth.currentUser;
  if (!user || user.email !== 'teacher@ourclass.kr') return showToast('선생님 계정으로 로그인한 상태에서만 바꿀 수 있어요');
  try {
    // 현재 비밀번호 확인은 Firebase가 직접 해요
    let reauthed = false, lastErr = null;
    for (const pw of [makePw(current), current]) {
      try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw)); reauthed = true; break; }
      catch(e) { lastErr = e; if (e.code === 'auth/too-many-requests') break; }
    }
    if (!reauthed) {
      if (lastErr?.code === 'auth/too-many-requests') return showToast('시도가 너무 많아 잠시 막혔어요. 5~10분 뒤에 다시 해 주세요');
      return showToast('현재 비밀번호가 틀렸어요');
    }
    if (newPw) await updatePassword(user, makePw(newPw));
    // 아이디만 config 에 저장. 예전에 저장하던 비밀번호 칸은 지워요.
    const updateData = { password: deleteField() };
    if (newId) updateData.teacherId = newId;
    await setDoc(doc(db, 'config', 'teacher'), updateData, { merge: true });
    state._cfgTeacher = null; // 캐시 무효화
    showToast('저장됐어요 ✅');
    document.getElementById('currentPw').value = '';
    document.getElementById('newTeacherId').value = '';
    document.getElementById('newPw').value = '';
    document.getElementById('confirmPw').value = '';
  } catch(e) { showToast('오류: ' + e.message); }
};
