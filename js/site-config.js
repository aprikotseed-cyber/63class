// site-config.js — 사이트 설정(로고·배경), 교사 프로필 캐릭터
import { state } from './state.js?v=20261111d';
import { db, deleteDoc, doc, serverTimestamp, setDoc } from './firebase.js?v=20261111d';
import { closeModal, getCfgSite, showToast } from './core.js?v=20261111d';
import { loadNotice } from './notice.js?v=20261111d';

// ===== 사이트 설정 로드 =====
export async function loadSiteSettings() {
  try {
    const d = await getCfgSite();
    if (Object.keys(d).length) {
      if (d.title) {
        document.getElementById('navTitle').textContent = d.title;
        document.title = d.title;
        const lt = document.getElementById('loginTitle');
        if (lt) lt.textContent = d.title;
      }
      if (d.logo) {
        document.getElementById('navLogo').textContent = d.logoImg ? '' : d.logo;
        const lp = document.getElementById('logoPreview');
        if (lp) lp.textContent = d.logo;
        const ll = document.getElementById('loginLogo');
        if (ll) ll.textContent = d.logo;
      }
      if (d.logoImg || d.logo) applySiteLogoImg(d.logoImg||'', d.logo||'🏫');
      if (d.loginBg || d.loginBgTeacher) applyLoginBg(d.loginBg||'', d.loginBgTeacher||'');
      const logoImgEl = document.getElementById('siteLogoImgUrl');
      const loginBgEl = document.getElementById('siteLoginBgUrl');
      const loginBgTeacherEl = document.getElementById('siteLoginBgTeacherUrl');
      if (logoImgEl && d.logoImg) { logoImgEl.value = d.logoImg; previewSiteLogoImg(); }
      if (loginBgEl && d.loginBg) { loginBgEl.value = d.loginBg; previewLoginBg('student'); }
      if (loginBgTeacherEl && d.loginBgTeacher) { loginBgTeacherEl.value = d.loginBgTeacher; previewLoginBg('teacher'); }
    }
  } catch(e) { console.log('사이트 설정 로드 실패', e); }
}

window.saveSiteSettings = async function() {
  const title = document.getElementById('siteNameInput').value.trim();
  const logo = document.getElementById('logoPreview').textContent.trim();
  const startDate = document.getElementById('classStartDate')?.value || '';
  const logoImg = document.getElementById('siteLogoImgUrl')?.value.trim() || '';
  const loginBg = document.getElementById('siteLoginBgUrl')?.value.trim() || '';
  const loginBgTeacher = document.getElementById('siteLoginBgTeacherUrl')?.value.trim() || '';
  if (!title) return showToast('홈페이지 이름을 입력하세요');
  try {
    await setDoc(doc(db, 'config', 'site'), { title, logo, startDate, logoImg, loginBg, loginBgTeacher }, { merge: true });
    document.getElementById('navTitle').textContent = title;
    document.title = title;
    document.getElementById('navLogo').textContent = logoImg ? '' : logo;
    applySiteLogoImg(logoImg, logo);
    applyLoginBg(loginBg, loginBgTeacher);
    showToast('저장됐어요 ✅');
  } catch(e) { showToast('오류: ' + e.message); }
};

// 로고 이미지 적용 (favicon + 로그인 화면 로고)
export function applySiteLogoImg(logoImg, logoEmoji) {
  const loginLogo = document.getElementById('loginLogo');
  const navLogo = document.getElementById('navLogo');

  // 로그인 로고
  if (loginLogo) {
    if (logoImg) {
      loginLogo.innerHTML = `<img src="${logoImg}" style="width:100px;height:100px;object-fit:contain;" onerror="this.parentElement.textContent='${logoEmoji||'🏫'}'" />`;
    } else {
      loginLogo.textContent = logoEmoji || '🏫';
    }
  }

  // 상단 nav 로고
  if (navLogo) {
    if (logoImg) {
      navLogo.innerHTML = `<img src="${logoImg}" style="width:28px;height:28px;object-fit:contain;vertical-align:middle;" onerror="this.parentElement.textContent='${logoEmoji||'🏫'}'" />`;
      navLogo.style.fontSize = '';
    } else {
      navLogo.textContent = logoEmoji || '🏫';
      navLogo.style.fontSize = '22px';
    }
  }

  // favicon 적용
  const link = document.querySelector("link[rel='icon']") || document.createElement('link');
  if (logoImg) {
    link.rel = 'icon';
    link.href = logoImg;
    link.type = 'image/png';
  } else {
    link.rel = 'icon';
    link.href = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${logoEmoji||'🏫'}</text></svg>`;
    link.type = '';
  }
  if (!document.querySelector("link[rel='icon']")) document.head.appendChild(link);
}

// 로그인 배경 이미지 적용 (학생용: ::after, 교사용: ::before)
export function applyLoginBg(studentBg, teacherBg) {
  const loginPage = document.getElementById('loginPage');
  if (!loginPage) return;
  // 학생용 ::after
  if (studentBg) {
    loginPage.style.setProperty('--login-bg-student', `url('${studentBg}')`);
    loginPage.classList.add('has-bg-image');
  } else {
    loginPage.style.removeProperty('--login-bg-student');
    if (!teacherBg) loginPage.classList.remove('has-bg-image');
  }
  // 교사용 ::before
  if (teacherBg) {
    loginPage.style.setProperty('--login-bg-teacher', `url('${teacherBg}')`);
    loginPage.classList.add('has-bg-image');
  } else {
    loginPage.style.removeProperty('--login-bg-teacher');
    if (!studentBg) loginPage.classList.remove('has-bg-image');
  }
  // CSS 변수로 pseudo 엘리먼트 배경 설정 (style 태그 동적 생성)
  let styleEl = document.getElementById('loginBgStyle');
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'loginBgStyle'; document.head.appendChild(styleEl); }
  const afterBg = studentBg ? `url('${studentBg}')` : 'none';
  const beforeBg = teacherBg
    ? `url('${teacherBg}')`
    : `linear-gradient(135deg,#c2e9fb 0%,#a1c4fd 30%,#d4b8f0 70%,#fbc2eb 100%)`;
  styleEl.textContent = `
    #loginPage::after  { background-image: ${afterBg}; }
    #loginPage::before { background-image: ${beforeBg}; ${teacherBg?'background-size:cover;background-position:center;':''} }
  `;
}

// 설정 화면 미리보기 함수
window.previewSiteLogoImg = function() {
  const url = document.getElementById('siteLogoImgUrl')?.value.trim();
  const img = document.getElementById('siteLogoImgPreview');
  const empty = document.getElementById('siteLogoImgEmpty');
  if (img && empty) {
    if (url) { img.src = url; img.style.display = 'block'; empty.style.display = 'none'; }
    else { img.style.display = 'none'; empty.style.display = 'block'; }
  }
};
window.previewLoginBg = function(type) {
  const isTeacher = type === 'teacher';
  const url = document.getElementById(isTeacher ? 'siteLoginBgTeacherUrl' : 'siteLoginBgUrl')?.value.trim();
  const img = document.getElementById(isTeacher ? 'siteLoginBgTeacherPreview' : 'siteLoginBgPreview');
  const empty = document.getElementById(isTeacher ? 'siteLoginBgTeacherEmpty' : 'siteLoginBgEmpty');
  if (img && empty) {
    if (url) { img.src = url; img.style.display = 'block'; empty.style.display = 'none'; }
    else { img.style.display = 'none'; empty.style.display = 'flex'; }
  }
};

// ===== 교사 프로필 캐릭터 URL =====
window.previewTeacherChar = function() {
  const url = document.getElementById('teacherCharUrl')?.value.trim();
  const img = document.getElementById('teacherCharPreview');
  const empty = document.getElementById('teacherCharPreviewEmpty');
  if (!img || !empty) return;
  if (url) {
    img.src = url;
    img.style.display = 'block';
    empty.style.display = 'none';
    img.onerror = () => { img.style.display = 'none'; empty.style.display = 'flex'; };
    img.onload  = () => { img.style.display = 'block'; empty.style.display = 'none'; };
  } else {
    img.style.display = 'none';
    empty.style.display = 'flex';
  }
};

window.saveTeacherCharUrl = async function() {
  const url = document.getElementById('teacherCharUrl')?.value.trim() || '';
  try {
    await setDoc(doc(db, 'config', 'teacher'), { charUrl: url }, { merge: true });
    state._cfgTeacher = null; // 캐시 무효화
    showToast('프로필 캐릭터가 저장됐어요 ✅');
  } catch(e) { showToast('오류: ' + e.message); }
};

window.saveNotice = async function() {
  const content = document.getElementById('noticeInput').value.trim();
  if (!content) return showToast('내용을 입력하세요');
  try {
    const avatar = document.getElementById('navAvatar').textContent || '👩‍🏫';
    await setDoc(doc(db, 'config', 'notice'), {
      content,
      teacherAvatar: avatar,
      updatedAt: serverTimestamp()
    });
    closeModal('noticeModal');
    showToast('공지사항이 저장됐어요 ✅');
    window._noticeLoaded = false; window._noticeLoadedTeacher = false;
    await loadNotice(true);
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteNotice = async function() {
  if (!confirm('공지사항을 삭제할까요?')) return;
  try {
    await deleteDoc(doc(db, 'config', 'notice'));
    document.getElementById('teacherNoticeContent').innerHTML = '<span class="notice-empty">공지사항을 작성해 보세요</span>';
    showToast('공지사항이 삭제됐어요');
  } catch(e) { showToast('오류: ' + e.message); }
};
