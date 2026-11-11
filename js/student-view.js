// student-view.js — 교사의 학생 뷰 전환
import { state } from './state.js?v=20261111c';
import { showToast } from './core.js?v=20261111c';

// ===== 👁️ 학생 뷰 전환 =====
let _teacherUserBackup = null;

window.openStudentViewModal = function() {
  if (!confirm('학생 화면으로 전환할까요?\n상단의 [🔙 교사로 돌아가기] 버튼으로 언제든 복귀할 수 있어요.')) return;
  enterStudentView();
};

window.enterStudentView = function() {
  // 교사 세션 백업
  _teacherUserBackup = { ...state.currentUser };

  // currentUser를 학생 모드로 임시 교체
  state.currentUser = {
    uid: state.currentUser.uid,
    name: state.currentUser.name,
    role: 'student',
  };

  // 사이드바 전환
  document.getElementById('teacherMenu').classList.add('hidden');
  document.getElementById('studentMenu').classList.remove('hidden');

  // 버튼 전환
  document.getElementById('studentViewBtn').style.display = 'none';
  document.getElementById('backToTeacherBtn').style.display = '';
  document.getElementById('navName').textContent = '[학생 뷰] ' + _teacherUserBackup.name;

  navigate('studentHome');
  showToast('👁️ 학생 화면으로 전환됐어요');
};

window.exitStudentView = function() {
  if (!_teacherUserBackup) return;

  // 교사 세션 복구
  state.currentUser = { ..._teacherUserBackup };
  _teacherUserBackup = null;

  // 사이드바 복구
  document.getElementById('teacherMenu').classList.remove('hidden');
  document.getElementById('studentMenu').classList.add('hidden');

  // 버튼 복구
  document.getElementById('studentViewBtn').style.display = '';
  document.getElementById('backToTeacherBtn').style.display = 'none';
  document.getElementById('navName').textContent = '선생님';

  navigate('teacherHome');
  showToast('🔙 교사 화면으로 돌아왔어요');
};
