// auth.js — 로그인(교사/학생), 자동 로그아웃, 교사 비밀번호 변경
import { state } from './state.js?v=20261111a';
import {
  auth, browserSessionPersistence, collection, createUserWithEmailAndPassword, db, doc, getDoc,
  getDocs, query, serverTimestamp, setDoc, setPersistence, signInWithEmailAndPassword, signOut,
  updateDoc, updatePassword, where
} from './firebase.js?v=20261111a';
import { getCfgTeacher, showToast } from './core.js?v=20261111a';
import { makePw, nameToEmail } from './level.js?v=20261111a';
import { enterApp } from './enter.js?v=20261111a';

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
  try {
    // 1단계: Firestore에서 아이디/비밀번호 확인
    const _tc3677 = await getCfgTeacher();
    const cfgDoc = { exists: () => true, data: () => _tc3677 };
    const storedPw = _tc3677.password || '0124';
    const storedId = cfgDoc.exists() && cfgDoc.data().teacherId ? cfgDoc.data().teacherId : 'teacher';
    // 비밀번호 확인
    if (nameInput !== storedId || pw !== storedPw) {
      errEl.style.display = 'block';
      return;
    }
    // 2단계: Firebase Auth로 로그인
    const teacherEmail = 'teacher@ourclass.kr';
    try {
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, teacherEmail, makePw(pw));
    } catch(authErr) {
      if (authErr.code === 'auth/user-not-found' || authErr.code === 'auth/invalid-credential' || authErr.code === 'auth/invalid-login-credentials') {
        // 계정 없으면 새로 생성
        await createUserWithEmailAndPassword(auth, teacherEmail, makePw(pw));
      } else if (authErr.code === 'auth/wrong-password') {
        // 비밀번호 불일치 - 이전 비밀번호 후보들로 로그인 후 업데이트 시도
        const candidates = ['0124!!', '0124', pw + '!!'];
        let fixed = false;
        for (const old of candidates) {
          try {
            const cred = await signInWithEmailAndPassword(auth, teacherEmail, old);
            await updatePassword(cred.user, makePw(pw));
            fixed = true;
            break;
          } catch(e2) {}
        }
        if (!fixed) {
          // 모든 시도 실패 - 기존 계정 삭제 후 재생성
          try {
            const { deleteUser } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
            // 현재 auth 사용자가 있으면 삭제
            if (auth.currentUser) await deleteUser(auth.currentUser);
          } catch(e3) {}
          await createUserWithEmailAndPassword(auth, teacherEmail, makePw(pw));
        }
      }
    }
    state.currentUser = { role: 'teacher', name: '선생님', uid: 'teacher' };
    enterApp();
  } catch(e) {
    console.error(e);
    errEl.style.display = 'block';
    errEl.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
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
    const email = nameToEmail(name);
    await setPersistence(auth, browserSessionPersistence);
    const cred = await signInWithEmailAndPassword(auth, email, makePw(pw));
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
  try {
    const _tcfg = await getCfgTeacher();
    const storedPw = _tcfg.password || '0124';
    if (current !== storedPw) return showToast('현재 비밀번호가 틀렸어요');
    if (newPw && newPw !== confirm2) return showToast('새 비밀번호가 일치하지 않아요');
    const updateData = {};
    if (newId) updateData.teacherId = newId;
    if (newPw) updateData.password = newPw;
    if (Object.keys(updateData).length === 0) return showToast('변경할 내용을 입력하세요');
    // Firestore 업데이트
    await setDoc(doc(db, 'config', 'teacher'), updateData, { merge: true });
    state._cfgTeacher = null; // 캐시 무효화
    // Firebase Auth 비밀번호도 업데이트
    if (newPw) {
      const teacherEmail = 'teacher@ourclass.kr';
      try {
        // 현재 비밀번호로 Auth 로그인 후 업데이트
        const { signInWithEmailAndPassword: signIn, updatePassword: updPw } =
          await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
        const cred = await signIn(auth, teacherEmail, makePw(current));
        await updPw(cred.user, makePw(newPw));
      } catch(authErr) {
        // Auth 업데이트 실패해도 Firestore는 저장됨 - 다음 로그인 시 자동 동기화
        console.warn('Auth 업데이트 실패, 다음 로그인 시 자동 동기화:', authErr.code);
      }
    }
    showToast('저장됐어요 ✅');
    document.getElementById('currentPw').value = '';
    document.getElementById('newTeacherId').value = '';
    document.getElementById('newPw').value = '';
    document.getElementById('confirmPw').value = '';
  } catch(e) { showToast('오류: ' + e.message); }
};
