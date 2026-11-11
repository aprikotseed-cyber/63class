// attendance.js — 출석 체크, 주간 출석 현황
import { state } from './state.js?v=20261111c';
import {
  addDoc, collection, db, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc,
  updateDoc, where
} from './firebase.js?v=20261111c';
import { closeModal, openModal, showToast } from './core.js?v=20261111c';
import { loadBanner } from './home.js?v=20261111c';

// ===== 출석 체크 (학생) =====
export function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function checkAttendanceDone() {
  const today = getTodayStr();
  try {
    // attendance는 캐싱 없이 항상 최신값 필요
  const aDoc = await getDoc(doc(db, 'attendance', `${today}_${state.currentUser.uid}`));
    return aDoc.exists();
  } catch(e) { return false; }
}

export async function updateAttendBtn() {
  const btn = document.getElementById('sidebarAttendBtn');
  if (!btn) return;
  // 이미 출석 완료 표시됐으면 스킵
  if (window._attendDone) { btn.textContent = '✅ 출석 완료!'; btn.classList.add('sidebar-attend-done'); btn.onclick = null; btn.style.opacity = '1'; return; }
  const done = await checkAttendanceDone();
  if (done) {
    window._attendDone = true; // 세션 캐시
    btn.textContent = '✅ 출석 완료!';
    btn.classList.add('sidebar-attend-done');
    btn.onclick = null;
  } else {
    btn.textContent = '✋ 출석 체크';
    btn.classList.remove('sidebar-attend-done');
    btn.onclick = openAttendCheck;
  }
  btn.style.opacity = '1';
}

window.openAttendCheck = async function() {
  const done = await checkAttendanceDone();
  if (done) return showToast('오늘 이미 출석했어요 ✅');
  document.getElementById('attendMessage').value = '';
  // 누적 출석 횟수 계산
  const badge = document.getElementById('attendCountBadge');
  if (badge) {
    const snap = await getDocs(query(collection(db,'attendance'), where('studentId','==',state.currentUser.uid)));
    badge.textContent = `${snap.size}회`;
  }
  openModal('attendCheckModal');
};

window.submitAttendance = async function() {
  // 중복 제출 방지
  if (window._attendSubmitting) return;
  window._attendSubmitting = true;

  const message = document.getElementById('attendMessage').value.trim();
  if (!message) { window._attendSubmitting = false; return showToast('한 마디를 입력해 주세요'); }
  if (message.length < 5) { window._attendSubmitting = false; return showToast('최소 5글자 이상 입력해 주세요 ✏️'); }
  const today = getTodayStr();
  try {
    // 이미 출석했는지 서버에서 재확인 (연타 방지)
    const alreadyDone = await checkAttendanceDone();
    if (alreadyDone) {
      closeModal('attendCheckModal');
      showToast('오늘 이미 출석했어요 ✅');
      window._attendDone = true;
      updateAttendBtn();
      window._attendSubmitting = false;
      return;
    }
    // 출석 포인트 로드 (캐시 우선)
    const attendPt = window._attendPoint || 20;
    // 출석 기록 저장
    await setDoc(doc(db, 'attendance', `${today}_${state.currentUser.uid}`), {
      studentId: state.currentUser.uid,
      studentName: state.currentUser.name,
      date: today,
      message,
      createdAt: serverTimestamp()
    });
    // 동적 포인트 지급
    await updateDoc(doc(db, 'students', state.currentUser.uid), {
      points: increment(attendPt),
      accumulatedPoints: increment(attendPt)
    });
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid,
      studentName: state.currentUser.name,
      delta: attendPt,
      reason: '출석 체크',
      type: 'plus',
      source: 'attendance',
      createdAt: serverTimestamp()
    });
    closeModal('attendCheckModal');
    showToast(`출석 완료! 🪙 ${attendPt}포인트를 받았어요 🎉`);
    if (window._attendCache) window._attendCache.counts = null;
    window._attendDone = true;
    await updateAttendBtn();
    await loadBanner(false);
  } catch(e) { showToast('오류: ' + e.message); }
  finally { window._attendSubmitting = false; }
};

// ===== 주간 출석 여부 확인 =====
window.openWeeklyAttendModal = async function() {
  openModal('weeklyAttendModal');
  document.getElementById('weeklyAttendHead').innerHTML = '';
  document.getElementById('weeklyAttendBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">불러오는 중...</td></tr>';

  // 이번 주 월~일 날짜 계산 (로컬 기준)
  const now = new Date();
  const dow = now.getDay(); // 0=일
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + diffToMon + i);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    weekDates.push(`${y}-${m}-${dd}`);
  }

  const monStr = weekDates[0];
  const sunStr = weekDates[6];
  document.getElementById('weeklyAttendRange').textContent = `${monStr} ~ ${sunStr}`;

  // 이번 주 출석 데이터 조회
  const attendSnap = await getDocs(query(
    collection(db, 'attendance'),
    where('date', '>=', monStr),
    where('date', '<=', sunStr)
  ));
  // studentId_date → true
  const attendMap = new Set();
  attendSnap.docs.forEach(d => {
    const data = d.data();
    attendMap.add(`${data.studentId}_${data.date}`);
  });

  // 학생 목록 (숨김 제외, 번호순)
  const vis = state.students.filter(s => !s.hidden).sort((a,b) => (a.number||0)-(b.number||0));
  const dayNames = ['월','화','수','목','금','토','일'];

  // 헤더
  const thStyle = 'padding:8px 10px;font-size:12px;font-weight:700;border:1px solid var(--border);background:var(--primary-light);color:var(--primary);text-align:center;white-space:nowrap;';
  document.getElementById('weeklyAttendHead').innerHTML = `<tr>
    <th style="${thStyle}">번호</th>
    <th style="${thStyle}">이름</th>
    ${weekDates.map((date, i) => {
      const isToday = date === getTodayStr();
      return `<th style="${thStyle}${isToday?'background:var(--primary);color:#fff;':''}">${dayNames[i]}<br><span style="font-size:10px;font-weight:400;">${date.slice(5)}</span></th>`;
    }).join('')}
  </tr>`;

  // 바디
  const tdStyle = 'padding:7px 6px;font-size:13px;border:1px solid var(--border);text-align:center;';
  document.getElementById('weeklyAttendBody').innerHTML = vis.map(s => {
    const cells = weekDates.map(date => {
      const attended = attendMap.has(`${s.id}_${date}`);
      const isFuture = date > getTodayStr();
      if (isFuture) return `<td style="${tdStyle}color:var(--text-muted);">—</td>`;
      return attended
        ? `<td style="${tdStyle}"><span style="font-size:16px;">✅</span></td>`
        : `<td style="${tdStyle}"><span style="font-size:16px;color:#ef4444;">❌</span></td>`;
    }).join('');
    return `<tr>
      <td style="${tdStyle}color:var(--text-muted);">${s.number||''}</td>
      <td style="${tdStyle}font-weight:600;">${s.name}</td>
      ${cells}
    </tr>`;
  }).join('');
};
window._attendPoint = 20; // 기본값

export async function loadAttendPoint() {
  try {
    const snap = await getDoc(doc(db, 'config', 'attendance'));
    if (snap.exists() && snap.data().point) {
      window._attendPoint = snap.data().point;
    }
  } catch(e) {}
  // 학생 출석 모달 subtitle 업데이트
  const sub = document.getElementById('attendCheckSubtitle');
  if (sub) sub.textContent = `선생님께 오늘의 긍정적인 한 마디를 전해요! 출석하면 🪙 ${window._attendPoint}포인트를 받아요.`;
}

window.openAttendPointModal = function() {
  document.getElementById('attendPointInput').value = window._attendPoint;
  openModal('attendPointModal');
};

window.saveAttendPoint = async function() {
  const val = parseInt(document.getElementById('attendPointInput').value);
  if (!val || val < 1) return showToast('1 이상의 숫자를 입력해 주세요');
  try {
    await setDoc(doc(db, 'config', 'attendance'), { point: val }, { merge: true });
    window._attendPoint = val;
    // 학생 출석 모달 subtitle 즉시 반영
    const sub = document.getElementById('attendCheckSubtitle');
    if (sub) sub.textContent = `선생님께 오늘의 긍정적인 한 마디를 전해요! 출석하면 🪙 ${val}포인트를 받아요.`;
    closeModal('attendPointModal');
    showToast(`출석 포인트가 ${val}🪙으로 설정됐어요 ✅`);
  } catch(e) { showToast('오류: ' + e.message); }
};
