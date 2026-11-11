// books.js — 독서량, 독서 완료 카드
import { state } from './state.js?v=20261111a';
import {
  addDoc, collection, db, doc, getDoc, getDocFromServer, getDocs, increment, query,
  serverTimestamp, setDoc, updateDoc, where
} from './firebase.js?v=20261111a';
import { closeModal, openModal, showToast } from './core.js?v=20261111a';
import { checkAndGrantRankUp } from './level.js?v=20261111a';
import { reloadStudents } from './realtime.js?v=20261111a';
import { renderDashboard } from './dashboard.js?v=20261111a';
import { praiseCards, reloadPraiseCards } from './cards.js?v=20261111a';

// ===== 독서량 (교사/학생 공통) =====
let _bookChartInstance = null;

// 현재 탭 상태
let _bookCurrentTab = 'week';

export function getCurrentWeekKey() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

function getPrevWeekKey(wk) {
  const [yr, wn] = wk.split('-W').map(Number);
  if (wn > 1) return `${yr}-W${String(wn-1).padStart(2,'0')}`;
  return `${yr-1}-W52`;
}

function weekToThursday(wk) {
  const [yr, wn] = wk.split('-W').map(Number);
  const jan4 = new Date(yr, 0, 4);
  const dow = jan4.getDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - dow + 1);
  const monday = new Date(week1Mon);
  monday.setDate(week1Mon.getDate() + (wn - 1) * 7);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  return thursday;
}

export async function loadChartJs() {
  if (window.Chart) return;
  await new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'; sc.onload=res; sc.onerror=rej; document.head.appendChild(sc); });
}

// 교사: bookManage 진입 시 호출
// ===== 통합 진입점 함수 =====
export async function renderBooksPage() {
  const isTeacher = state.currentUser?.role === 'teacher';
  const teacherInput = document.getElementById('bookTeacherInput');
  const teacherBtns = document.getElementById('bookTeacherBtns');
  // 교사 입력창은 데이터 로드 완료 전까지 숨김 유지
  if (teacherInput) teacherInput.style.display = 'none';
  if (teacherBtns) teacherBtns.style.display = isTeacher ? 'flex' : 'none';
  if (isTeacher) {
    const wkInput = document.getElementById('bookWeekInput');
    if (wkInput) wkInput.value = getCurrentWeekKey();
    // 그래프 먼저 그린 뒤 입력창 표시
    await bookSwitchTab(_bookCurrentTab);
    await loadBookWeekData();
    if (teacherInput) teacherInput.style.display = '';
  } else {
    await bookSwitchTab(_bookCurrentTab);
  }
}

async function renderBookManage() {
  const snap = await getDoc(doc(db, 'config', 'bookData_meta'));
  const wkInput = document.getElementById('bookWeekInput');
  if (wkInput && !wkInput.value) wkInput.value = getCurrentWeekKey();
  await loadBookWeekData();
}

window.loadBookWeekData = async function() {
  const wk = document.getElementById('bookWeekInput')?.value;
  const infoEl = document.getElementById('bookWeekSavedInfo');
  const sorted = [...state.students].sort((a,b)=>(a.number||999)-(b.number||999));
  let bookMap = {};
  if (wk) {
    const snap = await getDoc(doc(db, 'bookWeeks', wk));
    if (snap.exists()) {
      (snap.data().students||[]).forEach(s=>{ bookMap[s.id]=s; });
      if (infoEl) {
        const ud = snap.data().updatedAt?.toDate?.();
        if (ud) {
          const pad=n=>String(n).padStart(2,'0');
          const h=ud.getHours(); const ampm=h>=12?'PM':'AM'; const h12=h%12||12;
          infoEl.textContent=`✅ 저장된 데이터 있음, ${ud.getFullYear()}-${pad(ud.getMonth()+1)}-${pad(ud.getDate())} ${pad(h12)}:${pad(ud.getMinutes())} ${ampm}`;
        } else { infoEl.textContent='✅ 저장된 데이터 있음'; }
      }
    } else {
      // 새 주차 — 가장 최근 저장된 주차 데이터를 기본값으로 불러오기
      const allSnap = await getDocs(collection(db, 'bookWeeks'));
      const pastDocs = allSnap.docs
        .filter(d => d.id < wk)  // 현재 주차보다 이전인 것만
        .sort((a, b) => b.id.localeCompare(a.id)); // 최신순 정렬
      if (pastDocs.length > 0) {
        (pastDocs[0].data().students||[]).forEach(s=>{ bookMap[s.id]=s; });
        if (infoEl) infoEl.textContent = `📋 새 주차 — ${pastDocs[0].id} 데이터 불러옴 (저장 전)`;
      } else {
        if (infoEl) infoEl.textContent = '새 주차 — 입력 후 저장하세요';
      }
    }
  }
  const tbody = document.getElementById('bookManageTableBody');
  if (!tbody) return;
  tbody.innerHTML = sorted.map(s => {
    const val = bookMap[s.id]?.count || 0;
    return `<tr${s.hidden?' style="opacity:0.4;"':''}>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);color:var(--text-muted);">${s.number||''}</td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);font-weight:600;">${s.name}${s.hidden?'<span style="font-size:10px;color:#94a3b8;"> [숨김]</span>':''}</td>
      <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;">
        <input type="number" min="0" value="${val}" id="bookCount_${s.id}" style="width:70px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;text-align:center;font-size:14px;" />
      </td>
    </tr>`;
  }).join('');
  // 미리보기 렌더
  await bookSwitchTab(_bookCurrentTab);
};

window.saveBookData = async function() {
  const wk = document.getElementById('bookWeekInput')?.value;
  if (!wk) return showToast('주차를 선택해주세요');
  const sorted = [...state.students].sort((a,b)=>(a.number||999)-(b.number||999));
  const studentData = sorted.map(s=>({
    id:s.id, name:s.name, number:s.number||0,
    count: parseInt(document.getElementById(`bookCount_${s.id}`)?.value||'0')||0,
  }));
  await setDoc(doc(db, 'bookWeeks', wk), { weekKey:wk, students:studentData, updatedAt:serverTimestamp() });
  const infoEl = document.getElementById('bookWeekSavedInfo');
  if (infoEl) { const now=new Date(); const pad=n=>String(n).padStart(2,'0'); const h=now.getHours(); const ampm=h>=12?'PM':'AM'; const h12=h%12||12; infoEl.textContent=`✅ 저장된 데이터 있음, ${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(h12)}:${pad(now.getMinutes())} ${ampm}`; }
  showToast('📚 저장되었습니다.');
  await bookSwitchTab(_bookCurrentTab);
};

// 학생/교사 공통 탭 전환
window.bookSwitchTab = async function(tab) {
  _bookCurrentTab = tab;

  // 교사 탭 버튼
  const btnW1 = document.getElementById('bookPreviewTabWeek');
  const btnM1 = document.getElementById('bookPreviewTabMonth');
  if (btnW1) btnW1.className = tab==='week'?'btn btn-primary':'btn btn-secondary';
  if (btnM1) btnM1.className = tab==='month'?'btn btn-primary':'btn btn-secondary';

  // 학생 탭 버튼
  const btnW2 = document.getElementById('bookTabWeek');
  const btnM2 = document.getElementById('bookTabMonth');
  if (btnW2) btnW2.className = tab==='week'?'btn btn-primary':'btn btn-secondary';
  if (btnM2) btnM2.className = tab==='month'?'btn btn-primary':'btn btn-secondary';

  // 현재 활성 페이지의 컨테이너에 렌더
  const activePage = document.querySelector('section[id^="page-"]:not(.hidden)');
  const container = activePage?.querySelector('#bookSharedView, #bookSharedView2')
    || document.getElementById('bookSharedView2')
    || document.getElementById('bookSharedView');
  if (!container) return;

  if (tab === 'week') await renderBookWeekView(container);
  else await renderBookMonthView(container);
};

// 학생: bookChart 진입 시 호출
async function renderBookChart() {
  await bookSwitchTab(_bookCurrentTab);
}

// 공통: 이번 주 뷰
async function renderBookWeekView(container) {
  await loadChartJs();
  const wk = getCurrentWeekKey();
  const prevWk = getPrevWeekKey(wk);
  const hiddenIds = new Set(state.students.filter(s=>s.hidden).map(s=>s.id));
  const myName = state.currentUser?.name||'';

  // 이번 주 + 저번 주 동시 조회
  const [snap, prevSnap] = await Promise.all([
    getDoc(doc(db, 'bookWeeks', wk)),
    getDoc(doc(db, 'bookWeeks', prevWk))
  ]);

  let thisData = snap.exists() ? snap.data().students||[] : [];
  let prevData = prevSnap.exists() ? prevSnap.data().students||[] : [];

  // 이번 주 데이터 없으면 가장 최근 저장 데이터를 fallback
  if (!snap.exists()) {
    const allSnap = await getDocs(collection(db, 'bookWeeks'));
    const pastDocs = allSnap.docs
      .filter(d => d.id < wk)
      .sort((a, b) => b.id.localeCompare(a.id));
    if (pastDocs.length > 0) {
      thisData = pastDocs[0].data().students||[];
      // 저번 주는 그 이전 데이터
      if (pastDocs.length > 1) prevData = pastDocs[1].data().students||[];
    }
  }

  const prevMap = {}; prevData.forEach(s=>{prevMap[s.id]=s.count||0;});
  const rows = thisData.filter(r=>!hiddenIds.has(r.id)).sort((a,b)=>(b.count||0)-(a.count||0));

  // 순위 테이블 HTML
  const rankHtml = buildRankTable(rows, prevMap, 'week', myName);

  // 컨테이너 HTML 삽입
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:6fr 4fr;gap:16px;align-items:stretch;">
      <div class="card" style="padding:20px;min-width:0;display:flex;flex-direction:column;">
        <div style="display:flex;gap:20px;align-items:center;margin-bottom:12px;justify-content:center;font-size:13px;">
          <span style="display:flex;align-items:center;gap:6px;"><svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="#94a3b8" stroke-width="2.5"/></svg>저번 주</span>
          <span style="display:flex;align-items:center;gap:6px;"><svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="#6366f1" stroke-width="3"/></svg>이번 주</span>
        </div>
        <div style="position:relative;flex:1;min-height:200px;" id="bookChartWrap"><canvas id="bookChartCanvas" style="width:100%;display:block;"></canvas></div>
      </div>
      <div class="card" id="bookRankCard" style="padding:16px;min-width:0;display:flex;flex-direction:column;">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px;">🏆 독서량 순위</div>
        ${rankHtml}
      </div>
    </div>`;

  // 차트 그리기
  drawBookLineChart('bookChartCanvas',
    rows.map(r=>r.name),
    rows.map(r=>prevMap[r.id]||0),
    rows.map(r=>r.count||0),
    '저번 주', '이번 주'
  );
  syncBookHeight('bookRankCard','bookChartWrap');
}

// 공통: 이번 달 뷰
async function renderBookMonthView(container) {
  await loadChartJs();
  const now = new Date();
  const thisMonth=now.getMonth(), thisYear=now.getFullYear();
  const prevMonth=thisMonth===0?11:thisMonth-1;
  const prevYear=thisMonth===0?thisYear-1:thisYear;
  const currentWk=getCurrentWeekKey();
  const hiddenIds=new Set(state.students.filter(s=>s.hidden).map(s=>s.id));
  const myName=state.currentUser?.name||'';

  const weeksSnap=await getDocs(collection(db,'bookWeeks'));
  const weekDocs=weeksSnap.docs.sort((a,b)=>a.id<b.id?-1:1);
  const thisMonthWeeks=weekDocs.filter(d=>{ const t=weekToThursday(d.id); return t.getMonth()===thisMonth&&t.getFullYear()===thisYear&&d.id<=currentWk; });
  const prevMonthWeeks=weekDocs.filter(d=>{ const t=weekToThursday(d.id); return t.getMonth()===prevMonth&&t.getFullYear()===prevYear; });
  const thisLastWeek = thisMonthWeeks.length > 0 ? thisMonthWeeks[thisMonthWeeks.length-1] : null;
  const prevLastWeek = prevMonthWeeks.length > 0 ? prevMonthWeeks[prevMonthWeeks.length-1] : null;

  // 이번 달 데이터 없으면 전체 중 가장 최근 저장 데이터 fallback
  let thisMonthStudents = thisLastWeek ? thisLastWeek.data().students||[] : [];
  if (!thisLastWeek) {
    const pastDocs = weekDocs.filter(d => d.id < currentWk).sort((a,b)=>b.id.localeCompare(a.id));
    if (pastDocs.length > 0) thisMonthStudents = pastDocs[0].data().students||[];
  }

  if (!thisMonthStudents.length && !prevLastWeek) {
    container.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-muted);">이번 달 데이터가 없어요</div>';
    return;
  }
  const prevMap={}, thisMap={};
  if (prevLastWeek) (prevLastWeek.data().students||[]).forEach(r=>{prevMap[r.id]=r.count||0;});
  thisMonthStudents.forEach(r=>{thisMap[r.id]=r.count||0;});

  const studentList=state.students.filter(s=>!s.hidden);
  const rows=studentList.map(s=>({...s,prevCount:prevMap[s.id]||0,count:thisMap[s.id]||0})).sort((a,b)=>b.count-a.count);
  const pm=`${prevMonth+1}월`, tm=`${thisMonth+1}월`;

  const rankHtml = buildRankTable(rows.map(r=>({...r,count:r.count,_prev:r.prevCount})), null, 'month', myName, rows);

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:6fr 4fr;gap:16px;align-items:stretch;">
      <div class="card" style="padding:20px;min-width:0;display:flex;flex-direction:column;">
        <div style="display:flex;gap:20px;align-items:center;margin-bottom:12px;justify-content:center;font-size:13px;">
          <span style="display:flex;align-items:center;gap:6px;"><svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="#94a3b8" stroke-width="2.5"/></svg>${pm} 누적</span>
          <span style="display:flex;align-items:center;gap:6px;"><svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="#6366f1" stroke-width="3"/></svg>${tm} 누적</span>
        </div>
        <div style="position:relative;" id="bookChartWrap"><canvas id="bookChartCanvas" style="width:100%;display:block;"></canvas></div>
      </div>
      <div class="card" id="bookRankCard" style="padding:16px;min-width:0;display:flex;flex-direction:column;">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px;">🏆 ${tm} 독서량 순위</div>
        ${rankHtml}
      </div>
    </div>`;

  drawBookLineChart('bookChartCanvas',
    rows.map(r=>r.name),
    rows.map(r=>r.prevCount),
    rows.map(r=>r.count),
    `${pm} 누적`, `${tm} 누적`
  );
  syncBookHeight('bookRankCard','bookChartWrap');
}

function buildRankTable(rows, prevMap, mode, myName, monthRows) {
  const rl=[]; let cr=1;
  rows.forEach((r,i)=>{ if(i>0&&r.count===rows[i-1].count) rl.push(rl[i-1]); else{cr=i+1;rl.push(cr);} });
  const rc={}; rl.forEach(r=>{rc[r]=(rc[r]||0)+1;});
  const isWeek = mode==='week';
  const header = isWeek
    ? `<th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">저번 주</th>
       <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">이번 주</th>
       <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">증가량</th>
       <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">알림</th>`
    : `<th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">저번 달</th>
       <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">이번 달</th>
       <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">증가량</th>`;
  const tbody = rows.map((r,i)=>{
    const rank=rl[i]; const isMine=r.name===myName;
    const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':null;
    const rd=medal?medal:(rc[rank]>1?`공동 ${rank}위`:`${rank}위`);
    const prev = isWeek ? (prevMap?.[r.id]||0) : (r.prevCount||r._prev||0);
    const diff = r.count - prev;
    const alarm = isWeek && diff>=1
      ? `<span style="background:#ede9fe;color:#6366f1;border:1px solid #c4b5fd;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:600;white-space:nowrap;">📖 독서 완료</span>`
      : '';
    const extraCol = isWeek ? `<td style="padding:5px 4px;border-bottom:1px solid var(--border);text-align:center;">${alarm}</td>` : '';
    return `<tr style="${isMine?'background:var(--primary-light);font-weight:700;':''}">
      <td style="padding:5px 4px;border-bottom:1px solid var(--border);text-align:center;font-size:${medal?'18px':'13px'};">${rd}</td>
      <td style="padding:5px 4px;border-bottom:1px solid var(--border);text-align:center;">${r.name}${isMine?' 👈':''}</td>
      <td style="padding:5px 4px;border-bottom:1px solid var(--border);text-align:center;">${prev}</td>
      <td style="padding:5px 4px;border-bottom:1px solid var(--border);text-align:center;font-weight:600;">${r.count}</td>
      <td style="padding:5px 4px;border-bottom:1px solid var(--border);text-align:center;color:${diff>0?'#6366f1':diff<0?'#dc2626':'var(--text-muted)'};">${diff>0?'+':''}${diff}</td>
      ${extraCol}
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
    <thead><tr style="background:var(--bg);">
      <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">순위</th>
      <th style="padding:5px 4px;border-bottom:2px solid var(--border);text-align:center;">이름</th>
      ${header}
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>`;
}

function drawBookLineChart(canvasId, labels, prevData, thisData, prevLabel, thisLabel) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (_bookChartInstance) { _bookChartInstance.destroy(); _bookChartInstance=null; }
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const gc=isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.06)';
  const tc=isDark?'#cbd5e1':'#64748b';
  _bookChartInstance = new window.Chart(canvas, {
    type:'line',
    data:{ labels, datasets:[
      {label:prevLabel,data:prevData,borderColor:'#94a3b8',backgroundColor:'rgba(148,163,184,0.1)',borderWidth:2,pointRadius:5,pointBackgroundColor:'#94a3b8',pointBorderColor:'#fff',pointBorderWidth:2,tension:0.3,fill:false},
      {label:thisLabel,data:thisData,borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.15)',borderWidth:3,pointRadius:7,pointBackgroundColor:'#6366f1',pointBorderColor:'#fff',pointBorderWidth:2,tension:0.3,fill:'-1'}
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:900,easing:'easeOutQuart'},
      layout:{padding:{top:10,right:10,bottom:10,left:10}},
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:tc,font:{size:11},maxRotation:0},grid:{color:gc}},
        y:{beginAtZero:true,ticks:{color:tc,callback:v=>v+'권'},grid:{color:gc}}
      }
    }
  });
}

function syncBookHeight(rankCardId, chartWrapId) {
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      const rc = document.getElementById(rankCardId);
      const cw = document.getElementById(chartWrapId);
      if (!rc||!cw) return;
      const h = rc.getBoundingClientRect().height;
      if (h > 50) {
        cw.style.height = Math.round(h*0.85)+'px';
        if (_bookChartInstance) _bookChartInstance.resize();
      }
    });
  });
}

// ===== 📖 독서 완료 카드 지급 =====
let _bookCardSelected = null;

window.openBookGrantModal = async function() {
  const weekKey = getCurrentWeekKey();
  const prevWk = getPrevWeekKey(weekKey);

  // 화면과 동일하게 thisData/prevData 로드 (fallback 포함)
  const [thisSnap, prevSnap] = await Promise.all([
    getDoc(doc(db,'bookWeeks',weekKey)),
    getDoc(doc(db,'bookWeeks',prevWk))
  ]);

  let thisWeekStudents = thisSnap.exists() ? (thisSnap.data().students||[]) : [];
  let prevStudents = prevSnap.exists() ? (prevSnap.data().students||[]) : [];

  // 이번 주 데이터 없으면 최근 저장 데이터로 fallback
  if (!thisSnap.exists()) {
    const allSnap = await getDocs(collection(db,'bookWeeks'));
    const pastDocs = allSnap.docs.filter(d=>d.id<weekKey).sort((a,b)=>b.id.localeCompare(a.id));
    if (!pastDocs.length) return showToast('독서 데이터가 없어요. 먼저 저장해주세요.');
    thisWeekStudents = pastDocs[0].data().students||[];
    if (pastDocs.length > 1) prevStudents = pastDocs[1].data().students||[];
  }

  const prevMap = {};
  prevStudents.forEach(s => { prevMap[s.id] = s.count||0; });

  // 독서 완료 = 이번 주 count > 이전 주 count (화면과 동일 조건)
  const doneStudentIds = thisWeekStudents
    .filter(s => (s.count||0) > (prevMap[s.id]||0))
    .map(s => s.id);

  if (!doneStudentIds.length) return showToast('이번 주 독서 완료 학생이 없어요');

  const grantedSnap = await getDocs(query(collection(db,'bookCardLog'), where('weekKey','==',weekKey)));
  const alreadyGranted = new Map();
  grantedSnap.docs.forEach(d => { const r=d.data(); alreadyGranted.set(r.studentId, r.grantedAt?.toDate()); });

  window._bookGrantTargetIds = doneStudentIds;
  window._bookGrantWeekKey = weekKey;

  const newCount = doneStudentIds.filter(id => !alreadyGranted.has(id)).length;
  const oldCount = doneStudentIds.filter(id => alreadyGranted.has(id)).length;
  let infoHtml = '';
  if (oldCount > 0) {
    const oldDate = [...alreadyGranted.values()][0];
    const dateStr = oldDate ? `${oldDate.getFullYear()}-${String(oldDate.getMonth()+1).padStart(2,'0')}-${String(oldDate.getDate()).padStart(2,'0')}, ${oldDate.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 부여함` : '';
    infoHtml = `기존에 카드를 부여받은 학생은 <strong>${oldCount}명</strong>입니다.<br>부여받지 않은 <strong>${newCount}명</strong>에게 카드를 부여하시겠어요?<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">(${dateStr})</div>`;
  } else {
    infoHtml = `이번 주 독서 완료 학생 <strong>${doneStudentIds.length}명</strong>에게 카드를 부여해요.`;
  }
  if (newCount === 0) return showToast('부여할 학생이 없어요 (이미 모두 지급됨)');
  document.getElementById('bookGrantInfo').innerHTML = infoHtml;
  _bookCardSelected = null;
  if (!praiseCards.length) await reloadPraiseCards();
  switchBookCardTab('praise');
  openModal('bookGrantModal');
};

window.switchBookCardTab = function(type) {
  document.getElementById('bookCardTabPraise').className = type==='praise' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('bookCardTabPenalty').className = type==='penalty' ? 'btn btn-primary' : 'btn btn-secondary';
  _bookCardSelected = null;
  const filtered = praiseCards.filter(c => c.type === type).sort((a,b)=>(a.order||0)-(b.order||0));
  const listEl = document.getElementById('bookCardList');
  if (!filtered.length) { listEl.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">${type==='praise'?'칭찬':'벌점'} 카드가 없어요</div>`; return; }
  const abStr = c => {
    if (!c.abilities) return '';
    const entries = Object.entries(c.abilities).filter(([,v])=>v>0);
    return entries.length ? ' · '+entries.map(([k,v])=>`${k}+${v}`).join(' ') : '';
  };
  listEl.innerHTML = filtered.map(c=>`
    <div onclick="selectBookCard('${c.id}',this)" data-card-id="${c.id}"
      style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;
      border:1.5px solid var(--border);cursor:pointer;transition:all 0.15s;">
      <span style="font-size:22px;">${c.emoji||'💓'}</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;">${c.title}</div>
        <div style="font-size:12px;color:var(--text-muted);">${c.type==='praise'?'+':'-'}${c.point}🪙${abStr(c)}</div>
      </div>
    </div>`).join('');
};

window.selectBookCard = function(cardId, el) {
  _bookCardSelected = cardId;
  document.querySelectorAll('#bookCardList > div').forEach(d => { d.style.borderColor='var(--border)'; d.style.background='transparent'; });
  el.style.borderColor='var(--primary)'; el.style.background='var(--primary-light)';
};

window.confirmBookCardGrant = async function() {
  if (!_bookCardSelected) return showToast('카드를 선택하세요');
  const card = praiseCards.find(c=>c.id===_bookCardSelected);
  if (!card) return showToast('카드를 찾을 수 없어요');
  const weekKey = window._bookGrantWeekKey;
  const grantedSnap = await getDocs(query(collection(db,'bookCardLog'), where('weekKey','==',weekKey)));
  const alreadyGrantedIds = new Set(grantedSnap.docs.map(d=>d.data().studentId));
  const targets = (window._bookGrantTargetIds||[])
    .filter(id => !alreadyGrantedIds.has(id))
    .map(id => state.students.find(s=>s.id===id))
    .filter(Boolean);
  if (!targets.length) { closeModal('bookGrantModal'); showToast('부여할 학생이 없어요'); return; }
  const delta = card.type==='praise'?(card.point||0):-(card.point||0);
  for (const s of targets) {
    // 포인트 + 능력치 한 번에 처리
    const updateData = {
      points: increment(delta),
      ...(delta>0?{accumulatedPoints:increment(delta)}:{})
    };
    const abUpdate = {};
    if (card.abilities) {
      for (const [k,v] of Object.entries(card.abilities)) {
        if (v>0) {
          const abAmt = card.type==='praise'?v:-v;
          updateData[`abilities.${k}`] = increment(abAmt);
          if (abAmt > 0) abUpdate[k] = abAmt;
        }
      }
    }
    await updateDoc(doc(db,'students',s.id), updateData);
    // 랭크업 체크
    if (Object.keys(abUpdate).length > 0) {
      const freshSnap = await getDocFromServer(doc(db,'students',s.id));
      if (freshSnap.exists()) {
        const fd = freshSnap.data();
        const prevAb = {};
        for (const k of Object.keys(abUpdate)) prevAb[k] = (fd.abilities?.[k]||0) - abUpdate[k];
        await checkAndGrantRankUp(s.id, prevAb, abUpdate, fd.abilityRankGranted||{});
      }
    }
    await addDoc(collection(db,'givenCards'),{studentId:s.id,studentName:s.name,cardId:card.id,cardTitle:card.title,cardEmoji:card.emoji||'',type:card.type,cardType:card.type,cost:card.point||0,delta:card.type==='praise'?(card.point||0):-(card.point||0),source:'bookGrant',createdAt:serverTimestamp(),givenAt:serverTimestamp()});
    await addDoc(collection(db,'history'),{studentId:s.id,studentName:s.name,delta,reason:`독서 완료 카드 부여: ${card.emoji||''} ${card.title}`,type:card.type==='praise'?'plus':'minus',source:'bookGrant',createdAt:serverTimestamp()});
    await addDoc(collection(db,'bookCardLog'),{weekKey,studentId:s.id,cardId:card.id,grantedAt:serverTimestamp()});
  }
  closeModal('bookGrantModal');
  showToast(`${targets.length}명에게 '${card.emoji||''} ${card.title}' 지급 완료 ✅`);
  await reloadStudents(); renderDashboard();
};
