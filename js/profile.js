// profile.js — 학생 설정·비밀번호·프로필 메시지
import { state } from './state.js?v=20261111d';
import { EmailAuthProvider, addDoc, auth, collection, db, doc, reauthenticateWithCredential, serverTimestamp, updateDoc, updatePassword } from './firebase.js?v=20261111d';
import { closeModal, getMyStudentData, openModal, showToast } from './core.js?v=20261111d';
import { makePw } from './level.js?v=20261111d';
import { pwCandidates, savePwHint } from './accounts.js?v=20261111d';
import { buildCharHtml } from './avatar.js?v=20261111d';

// ===== 학생: 설정 =====
window.saveProfile = async function() {
  try {
    // character 필드 저장 제거 - 아바타 파츠로 캐릭터 구성하는 방식으로 변경
    showToast('프로필이 저장됐어요 ✅');
  } catch(e) { showToast('오류: ' + e.message); }
};

export async function renderStudentSettings() {
  const _ms = getMyStudentData();
  const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
  const data = sDoc.data() || {};

  // 프로필 미리보기: 착용 아이템 기준 (레이어 합성)
  document.getElementById('myProfilePreview').innerHTML = buildCharHtml({ id: state.currentUser.uid, avatarEquipped: data.avatarEquipped, avatarEquippedMeta: data.avatarEquippedMeta });
  document.getElementById('myProfileName').textContent = state.currentUser.name;
  document.getElementById('myProfilePoints').textContent = `🪙 ${(data.points || 0).toLocaleString()} 포인트`;

  // 설정 화면 프로필 이모지 미리보기
  const settingAvatar = document.getElementById('settingAvatarPreview');
  if (settingAvatar) {
    settingAvatar.textContent = data.avatarEmoji || document.getElementById('navAvatar')?.textContent || '😊';
  }
}

// ===== 학생: 비밀번호 변경 =====
window.changeStudentPassword = async function() {
  const current = document.getElementById('studentCurrentPw').value.trim();
  const newPw = document.getElementById('studentNewPw').value.trim();
  const confirm2 = document.getElementById('studentConfirmPw').value.trim();
  if (!current || !newPw || !confirm2) return showToast('모든 항목을 입력하세요');
  if (newPw !== confirm2) return showToast('새 비밀번호가 일치하지 않아요');
  if (newPw.length < 4) return showToast('비밀번호는 4자리 이상이어야 해요');
  const user = auth.currentUser;
  if (!user) return showToast('로그인이 풀렸어요. 다시 로그인해 주세요');
  if (user.email === 'teacher@ourclass.kr') return showToast('학생 뷰에서는 학생 비밀번호를 바꿀 수 없어요. 학생 관리 → 🔒 비번변경을 써 주세요');
  try {
    // 현재 비밀번호로 재인증 — 이름으로 이메일을 다시 만들지 않고, 지금 로그인한 계정의 실제 이메일을 씀
    // (예전엔 이름으로 만든 이메일이 계정과 조금만 달라도 비밀번호가 맞는데 실패했어요)
    let reauthed = false, lastErr = null;
    for (const pw of pwCandidates([current])) {
      try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw)); reauthed = true; break; }
      catch (e) { lastErr = e; if (e.code === 'auth/too-many-requests') break; }
    }
    if (!reauthed) throw lastErr;
    await updatePassword(user, makePw(newPw));
    // 비밀번호 기록 저장 (선생님만 볼 수 있는 보관함). 실패해도 비밀번호 자체는 이미 바뀌었으므로 실패로 보이지 않게 분리
    try { await savePwHint(state.currentUser.uid, newPw); } catch(e3) { console.error('비밀번호 기록 저장 실패', e3); }
    showToast('비밀번호가 변경됐어요 ✅ 이제 새 비밀번호로 로그인하세요');
    document.getElementById('studentCurrentPw').value = '';
    document.getElementById('studentNewPw').value = '';
    document.getElementById('studentConfirmPw').value = '';
  } catch(e) {
    if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') {
      showToast('현재 비밀번호가 틀렸어요');
    } else if (e?.code === 'auth/too-many-requests') {
      showToast('시도가 너무 많아 잠시 막혔어요. 5~10분 뒤에 다시 해 주세요');
    } else {
      showToast('오류: ' + e.message);
    }
  }
};

// ===== 프로필 메시지 =====
window.openProfileMsgModal = function(e) {
  e.stopPropagation(); // 친구 상세보기 클릭 방지
  const me = state.students.find(s => s.id === state.currentUser.uid);
  document.getElementById('profileMsgInput').value = me?.profileMsg || '';
  openModal('profileMsgModal');
};

window.saveProfileMsg = async function() {
  const msg = document.getElementById('profileMsgInput').value.trim().slice(0, 20);
  await updateDoc(doc(db, 'students', state.currentUser.uid), { profileMsg: msg });
  // 변경 이력 저장
  await addDoc(collection(db, 'profileMsgLog'), {
    studentId: state.currentUser.uid,
    studentName: state.currentUser.name,
    message: msg || '(삭제)',
    changedAt: serverTimestamp()
  });
  closeModal('profileMsgModal');
  showToast('프로필 메시지가 저장됐어요 ✅');
};

window.deleteProfileMsg = async function() {
  await updateDoc(doc(db, 'students', state.currentUser.uid), { profileMsg: '' });
  // 삭제 이력 저장
  await addDoc(collection(db, 'profileMsgLog'), {
    studentId: state.currentUser.uid,
    studentName: state.currentUser.name,
    message: '(삭제)',
    changedAt: serverTimestamp()
  });
  closeModal('profileMsgModal');
  showToast('프로필 메시지가 삭제됐어요');
};
