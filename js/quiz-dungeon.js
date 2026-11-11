// quiz-dungeon.js — 문제 던전
import { state } from './state.js?v=20261111b';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, updateDoc
} from './firebase.js?v=20261111b';
import { closeModal, getCfgTeacher, openModal, showToast } from './core.js?v=20261111b';
import { pushNotif } from './realtime.js?v=20261111b';

// ===================================================
// 📚 문제 던전 시스템
// ===================================================
let quizQuestions     = [];   // 편집 중인 문제 목록

const AB_ICONS_QUIZ = { '성실성':'🌟','인성':'❤️','사회성':'🤝','지력':'📚','집중력':'⚡' };

window.resetQuizQuestions = async function() {
  if (!confirm('문제 목록을 전부 삭제할까요?\n저장된 문제가 모두 삭제됩니다.')) return;
  window._quizResetting = true;
  quizQuestions = [];
  state.quizDungeonConfig = null; // 캐시 완전 무효화
  // Firestore에도 즉시 반영
  try {
    const existing = await getDoc(doc(db, 'config', 'quizDungeon'));
    if (existing.exists()) {
      await updateDoc(doc(db, 'config', 'quizDungeon'), { questions: [] });
    }
  } catch(e) {}
  renderQuizQuestions();
  window._quizResetting = false;
  showToast('문제가 초기화됐어요');
};

export async function loadQuizDungeonConfig() {
  if (state.quizDungeonConfig) return state.quizDungeonConfig;
  const snap = await getDoc(doc(db, 'config', 'quizDungeon'));
  state.quizDungeonConfig = snap.exists() ? snap.data() : null;
  return state.quizDungeonConfig;
}
export async function loadQuizDungeonBoss() {
  if (state.quizDungeonBoss !== undefined) return state.quizDungeonBoss;
  const snap = await getDoc(doc(db, 'config', 'quizDungeonBoss'));
  state.quizDungeonBoss = snap.exists() ? snap.data() : null;
  return state.quizDungeonBoss;
}

// ── 교사: 모달 열기
window.openQuizDungeonModal = async function() {
  const cfg = await loadQuizDungeonConfig();
  // 기존 설정 복원
  if (cfg) {
    document.getElementById('qdName').value    = cfg.name    || '';
    document.getElementById('qdLives').value   = cfg.lives   || 2;
    document.getElementById('qdReward').value  = cfg.reward  || 1000;
    document.getElementById('qdLifeBonus').value = cfg.lifeBonus || 100;
    if (cfg.monImg) {
      document.getElementById('qdMonImg').value = cfg.monImg;
      const p = document.getElementById('qdMonPreview');
      const e = document.getElementById('qdMonPreviewEmpty');
      if (p) { p.src = cfg.monImg; p.style.display = 'block'; }
      if (e) e.style.display = 'none';
    }
    if (cfg.bgImg) {
      document.getElementById('qdBgImg').value = cfg.bgImg;
      const p = document.getElementById('qdBgPreview');
      const e = document.getElementById('qdBgPreviewEmpty');
      if (p) { p.src = cfg.bgImg; p.style.display = 'block'; }
      if (e) e.style.display = 'none';
    }
    // 능력치
    const abs = cfg.abReward || {};
    Object.keys(AB_ICONS_QUIZ).forEach(k => {
      const cb = document.getElementById(`qdAb_${k}`);
      const inp = document.getElementById(`qdAbV_${k}`);
      if (abs[k]) { cb.checked = true; inp.value = abs[k]; inp.disabled = false; }
      else { cb.checked = false; inp.disabled = true; }
    });
    quizQuestions = cfg.questions ? JSON.parse(JSON.stringify(cfg.questions)) : [];
  } else {
    quizQuestions = [];
  }
  renderQuizQuestions();
  openModal('quizDungeonModal');
};

// 능력치 체크박스 토글
document.addEventListener('change', e => {
  if (e.target.id?.startsWith('qdAb_')) {
    const k = e.target.id.replace('qdAb_', '');
    document.getElementById(`qdAbV_${k}`).disabled = !e.target.checked;
  }
});

// ── DOM에서 현재 입력값을 quizQuestions에 저장
function syncQuizFromDOM() {
  if (window._quizResetting) return; // 초기화 중이면 스킵
  const list = document.getElementById('qdQuestionList');
  if (!list || quizQuestions.length === 0) return;
  const domItems = list.querySelectorAll('[id^="qText_"]');
  if (domItems.length !== quizQuestions.length) return;
  quizQuestions.forEach((q, qi) => {
    // 문제 텍스트
    const ta = list.querySelector(`#qText_${qi}`);
    if (ta) q.text = ta.value;
    if (q.type === 'multiple') {
      // 선택지 텍스트
      q.choices = q.choices.map((_, ci) => {
        const inp = list.querySelector(`#qChoice_${qi}_${ci}`);
        return inp ? inp.value : _;
      });
      // 복수 정답 (체크박스)
      q.answers = q.choices.map((_, ci) => {
        const cb = list.querySelector(`#qAns_${qi}_${ci}`);
        return cb ? cb.checked : false;
      });
    } else {
      // 주관식 정답
      q.answers = (q.answers || ['']).map((_, ai) => {
        const inp = list.querySelector(`#qShortAns_${qi}_${ai}`);
        return inp ? inp.value : _;
      });
    }
  });
}

// ── 문제 추가
window.addQuizQuestion = function() {
  syncQuizFromDOM();
  quizQuestions.push({ type: 'multiple', text: '', choices: ['','','',''], answers: [false,false,false,false] });
  renderQuizQuestions();
};

// ── 문제 목록 렌더
function renderQuizQuestions() {
  const list = document.getElementById('qdQuestionList');
  const cnt  = document.getElementById('qdQuestionCount');
  if (!list) return;
  cnt.textContent = quizQuestions.length;
  list.innerHTML = quizQuestions.map((q, qi) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:14px;background:var(--bg);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-weight:700;font-size:13px;">${qi+1}번 문제</span>
        <div style="display:flex;gap:6px;">
          <select id="qType_${qi}" onchange="changeQuizType(${qi},this.value)" style="font-size:12px;padding:3px 6px;">
            <option value="multiple" ${q.type==='multiple'?'selected':''}>객관식</option>
            <option value="short"    ${q.type==='short'?'selected':''}>주관식</option>
          </select>
          <button onclick="removeQuizQuestion(${qi})" style="background:#fee2e2;border:none;color:#dc2626;padding:4px 16px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">삭제</button>
        </div>
      </div>
      <textarea id="qText_${qi}" placeholder="문제를 입력하세요" rows="2"
        style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">${q.text||''}</textarea>
      ${q.type === 'multiple' ? renderMultipleChoice(q, qi) : renderShortAnswer(q, qi)}
    </div>
  `).join('');
}

function renderMultipleChoice(q, qi) {
  const answers = Array.isArray(q.answers) ? q.answers : [];
  return `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">☑ 정답 선택지에 체크 (복수 선택 가능)</div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${(q.choices||[]).map((c,ci) => `
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="qAns_${qi}_${ci}" ${answers[ci]?'checked':''} style="width:16px;height:16px;flex-shrink:0;cursor:pointer;" />
          <input type="text" id="qChoice_${qi}_${ci}" value="${c}" placeholder="${ci+1}번 선택지"
            style="flex:1;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();var n=document.getElementById('qChoice_${qi}_'+(${ci}+1));n?n.focus():null;}" />
          ${q.choices.length > 2 ? `<button onclick="removeChoice(${qi},${ci})" style="background:#fee2e2;border:none;color:#dc2626;padding:4px 14px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;flex-shrink:0;">삭제</button>` : ''}
        </div>
      `).join('')}
      <button onclick="addChoice(${qi})" style="font-size:12px;color:var(--primary);background:none;border:1px dashed var(--primary);border-radius:6px;padding:5px;cursor:pointer;margin-top:2px;">+ 선택지 추가</button>
    </div>`;
}

function renderShortAnswer(q, qi) {
  const answers = Array.isArray(q.answers) ? q.answers : [''];
  return `
    <div style="display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);">정답 (복수 정답 가능)</div>
      ${answers.map((a, ai) => `
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="text" id="qShortAns_${qi}_${ai}" value="${a}" placeholder="정답 ${ai+1}"
            style="flex:1;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;" />
          ${answers.length > 1 ? `<button onclick="removeShortAnswer(${qi},${ai})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px;">✕</button>` : ''}
        </div>
      `).join('')}
      <button onclick="addShortAnswer(${qi})" style="font-size:12px;color:var(--primary);background:none;border:1px dashed var(--primary);border-radius:6px;padding:5px;cursor:pointer;margin-top:2px;">+ 정답 추가</button>
    </div>`;
}

window.changeQuizType = function(qi, type) {
  syncQuizFromDOM();
  quizQuestions[qi].type = type;
  if (type === 'multiple') {
    if (!quizQuestions[qi].choices?.length) quizQuestions[qi].choices = ['','','',''];
    if (!Array.isArray(quizQuestions[qi].answers)) quizQuestions[qi].answers = quizQuestions[qi].choices.map(() => false);
  } else {
    quizQuestions[qi].answers = [''];
    delete quizQuestions[qi].choices;
  }
  renderQuizQuestions();
};
window.removeQuizQuestion = function(qi) { syncQuizFromDOM(); quizQuestions.splice(qi,1); renderQuizQuestions(); };
window.addChoice = function(qi) {
  syncQuizFromDOM();
  quizQuestions[qi].choices.push('');
  quizQuestions[qi].answers.push(false);
  renderQuizQuestions();
};
window.removeChoice = function(qi,ci) {
  syncQuizFromDOM();
  quizQuestions[qi].choices.splice(ci,1);
  quizQuestions[qi].answers.splice(ci,1);
  renderQuizQuestions();
};
window.addShortAnswer = function(qi) {
  syncQuizFromDOM();
  if (!Array.isArray(quizQuestions[qi].answers)) quizQuestions[qi].answers = [''];
  quizQuestions[qi].answers.push('');
  renderQuizQuestions();
};
window.removeShortAnswer = function(qi,ai) {
  syncQuizFromDOM();
  quizQuestions[qi].answers.splice(ai,1);
  renderQuizQuestions();
};

// ── 저장
window.saveQuizDungeon = async function() {
  const data = collectQuizConfig();
  if (!data) return;
  await setDoc(doc(db, 'config', 'quizDungeon'), data);
  state.quizDungeonConfig = data;
  showToast('문제 던전이 저장됐어요 💾');
  loadQuizDungeonManageStatus();
};

function collectQuizConfig() {
  if (!window._quizResetting) syncQuizFromDOM(); // 초기화 중 아닐 때만 DOM 수집
  const name   = document.getElementById('qdName').value.trim();
  const lives  = parseInt(document.getElementById('qdLives').value) || 2;
  const reward = parseInt(document.getElementById('qdReward').value) || 0;
  const lifeBonus = parseInt(document.getElementById('qdLifeBonus').value) || 0;
  const monImg = document.getElementById('qdMonImg').value.trim();
  const bgImg  = document.getElementById('qdBgImg').value.trim();
  if (!name) return showToast('던전 이름을 입력하세요'), null;
  if (!quizQuestions.length) return showToast('문제를 1개 이상 추가하세요'), null;
  // 문제 검증
  for (let i=0; i<quizQuestions.length; i++) {
    const q = quizQuestions[i];
    if (!q.text.trim()) return showToast(`${i+1}번 문제 내용을 입력하세요`), null;
    if (q.type === 'multiple' && (!q.choices || q.choices.some(c=>!c.trim())))
      return showToast(`${i+1}번 문제 선택지를 모두 입력하세요`), null;
    if (q.type === 'multiple' && !q.answers?.some(a=>a===true))
      return showToast(`${i+1}번 문제에서 정답을 1개 이상 선택하세요`), null;
    if (q.type === 'short' && (!q.answers || !q.answers.some(a=>a.trim())))
      return showToast(`${i+1}번 문제 정답을 입력하세요`), null;
  }
  const abReward = {};
  Object.keys(AB_ICONS_QUIZ).forEach(k => {
    const cb = document.getElementById(`qdAb_${k}`);
    if (cb?.checked) abReward[k] = parseInt(document.getElementById(`qdAbV_${k}`).value)||1;
  });
  return { name, lives, reward, lifeBonus, abReward, monImg, bgImg, questions: quizQuestions };
}

// ── 활성화
window.activateQuizDungeon = async function() {
  // 모달이 열려있으면 DOM에서 수집, 아니면 저장된 캐시 사용
  const modalOpen = !document.getElementById('quizDungeonModal').classList.contains('hidden');
  let data;
  if (modalOpen) {
    data = collectQuizConfig();
    if (!data) return;
  } else {
    // 저장된 설정 그대로 활성화
    const cfg = await loadQuizDungeonConfig();
    if (!cfg) return showToast('먼저 문제 설정에서 설정을 저장하세요');
    if (!cfg.name) return showToast('던전 이름이 없어요. 문제 설정에서 저장해주세요');
    if (!cfg.questions?.length) return showToast('문제가 없어요. 문제 설정에서 저장해주세요');
    data = cfg;
  }
  if (!confirm(`'${data.name}' 문제 던전을 활성화할까요?`)) return;
  await setDoc(doc(db, 'config', 'quizDungeon'), data);
  state.quizDungeonConfig = data;
  await setDoc(doc(db, 'config', 'quizDungeonBoss'), {
    name: data.name, active: true,
    activatedAt: serverTimestamp(),
    participants: []
  });
  state.quizDungeonBoss = undefined;
  showToast('문제 던전이 활성화됐어요 ⚔️');
  if (modalOpen) closeModal('quizDungeonModal');
  loadQuizDungeonManageStatus();
  updateQuizDungeonBadge();
};

// ── 초기화
window.resetQuizDungeon = async function() {
  if (!confirm('문제 던전을 초기화할까요? 모든 참여 기록이 삭제돼요.')) return;
  await deleteDoc(doc(db, 'config', 'quizDungeonBoss'));
  state.quizDungeonBoss = undefined;
  showToast('문제 던전이 초기화됐어요');
  loadQuizDungeonManageStatus();
};

// ── 교사: 상태 표시
export async function loadQuizDungeonManageStatus() {
  const el = document.getElementById('quizDungeonStatus');
  if (!el) return;
  const boss = await loadQuizDungeonBoss();
  const cfg  = state.quizDungeonConfig;
  if (boss?.active) {
    const cnt = (boss.participants||[]).length;
    el.innerHTML = `<strong>활성화됨:</strong> ${boss.name} | 문제 ${cfg?.questions?.length||0}개 | 참여 학생 ${cnt}명`;
  } else if (cfg) {
    el.innerHTML = `저장된 설정 있음: <strong>${cfg.name}</strong> (${cfg.questions?.length||0}문제) — 아직 비활성화 상태`;
  } else {
    el.innerHTML = '아직 설정된 문제 던전이 없어요.';
  }
}

// ── 학생: 배지
export async function updateQuizDungeonBadge() {
  const badge = document.getElementById('quizDungeonBadge');
  if (!badge || !state.currentUser || state.currentUser.role !== 'student') return;
  const boss = await loadQuizDungeonBoss();
  const participated = (boss?.participants||[]).includes(state.currentUser.uid);
  badge.style.display = (boss?.active && !participated) ? 'block' : 'none';
}

// ── 학생: 문제 던전 섹션 렌더 (던전 페이지 하단)
export async function renderQuizDungeonSection() {
  const section = document.getElementById('quizDungeonSection');
  if (!section || state.currentUser?.role !== 'student') return;
  const [cfg, boss] = await Promise.all([loadQuizDungeonConfig(), loadQuizDungeonBoss()]);

  const participated = boss?.active && (boss.participants||[]).includes(state.currentUser.uid);

  // 비활성화 상태
  if (!boss?.active) {
    const bgStyle = cfg?.bgImg
      ? `background-image:url('${cfg.bgImg}');background-size:cover;background-position:center;`
      : 'background:#666;';

    const monStyle = `position:relative;width:135px;height:135px;object-fit:contain;display:block;margin:0 auto 8px;filter:grayscale(1);`;
    const monHtml = cfg?.monImg
      ? `<img src="${cfg.monImg}" style="${monStyle}" />`
      : '<div style="position:relative;font-size:64px;text-align:center;margin-bottom:8px;filter:grayscale(1);">😴</div>';
    section.innerHTML = `
      <div class="card" style="padding:16px;box-sizing:border-box;flex:1;display:flex;flex-direction:column;height:100%;">
        <div style="font-size:16px;font-weight:700;margin-bottom:12px;">📚 문제 던전 현황</div>
        <div style="${bgStyle}border-radius:var(--radius-lg);height:300px;text-align:center;position:relative;overflow:hidden;transition:box-shadow 0.2s,transform 0.2s;display:flex;flex-direction:column;justify-content:flex-start;padding-top:40px;"
          onmouseenter="this.style.boxShadow='0 6px 24px rgba(0,0,0,0.3)';this.style.transform='translateY(-4px)'" onmouseleave="this.style.boxShadow='';this.style.transform=''">
          <div style="position:absolute;inset:0;backdrop-filter:grayscale(1) brightness(0.85);-webkit-backdrop-filter:grayscale(1) brightness(0.85);background:rgba(0,0,0,0.1);border-radius:var(--radius-lg);pointer-events:none;z-index:1;"></div>
          <div style="position:relative;z-index:2;">${monHtml}</div>
          <div style="position:relative;font-size:18px;font-weight:700;color:#ccc;margin-bottom:6px;z-index:2;">문제 던전 보스</div>
          <div style="position:relative;font-size:17px;color:#ccc;font-weight:500;z-index:2;">보스는 깊은 잠에 빠져 있습니다.</div>
        </div>
      </div>`;
    return;
  }

  // 활성화 + 참여 완료
  if (participated) {
    const bgStyle = cfg?.bgImg
      ? `background-image:url('${cfg.bgImg}');background-size:cover;background-position:center;`
      : 'background:#666;';
    const monStyle = `position:relative;width:135px;height:135px;object-fit:contain;display:block;margin:0 auto 8px;filter:grayscale(1);`;
    const monHtml = cfg?.monImg
      ? `<img src="${cfg.monImg}" style="${monStyle}" />`
      : '<div style="position:relative;font-size:64px;text-align:center;margin-bottom:8px;">✅</div>';
    section.innerHTML = `
      <div class="card" style="padding:16px;box-sizing:border-box;flex:1;display:flex;flex-direction:column;height:100%;">
        <div style="font-size:16px;font-weight:700;margin-bottom:12px;">📚 문제 던전 현황</div>
        <div style="${bgStyle}border-radius:var(--radius-lg);height:300px;text-align:center;position:relative;overflow:hidden;cursor:default;transition:box-shadow 0.2s,transform 0.2s;display:flex;flex-direction:column;justify-content:flex-start;padding-top:40px;"
          onmouseenter="this.style.boxShadow='0 6px 24px rgba(0,0,0,0.35)';this.style.transform='translateY(-4px)'" onmouseleave="this.style.boxShadow='';this.style.transform=''">
          <div style="position:absolute;inset:0;backdrop-filter:grayscale(1) brightness(0.85);-webkit-backdrop-filter:grayscale(1) brightness(0.85);background:rgba(0,0,0,0.35);border-radius:var(--radius-lg);pointer-events:none;z-index:1;"></div>
          <div style="position:relative;z-index:2;">${monHtml}</div>
          <div style="position:relative;font-size:18px;font-weight:700;color:#ccc;margin-bottom:4px;z-index:2;">${boss.name}</div>
          <div style="position:relative;font-size:13px;color:#aaa;margin-bottom:4px;z-index:2;">📝 ${cfg?.questions?.length||0}문제 · ${'♥'.repeat(cfg?.lives||2)} ${cfg?.lives||2}개</div>
          ${(() => {
            const cnt = (boss.participants||[]).length;
            const clr = (boss.clearers||[]).length;
            const answered = boss.totalAnswered || 0;
            const asked = boss.totalQuestions || 0;
            const rate = asked > 0 ? Math.round(answered / asked * 100) : 0;
            return `<div style="position:relative;font-size:12px;color:#888;margin-bottom:4px;z-index:2;">정답률 ${rate}% · ${cnt}명 중 ${clr}명이 최종 클리어했어요</div>`;
          })()}
          <div style="position:relative;font-size:13px;color:#aaa;z-index:2;">✅ 이미 참여한 문제 던전이에요.</div>
        </div>
      </div>`;
    return;
  }

  // 활성화 + 미참여
  const bgStyle = cfg?.bgImg ? `background-image:url('${cfg.bgImg}');background-size:cover;background-position:center;` : 'background:linear-gradient(135deg,#1e1b4b,#312e81);';
  const monHtml = cfg?.monImg
    ? `<img src="${cfg.monImg}" style="position:relative;width:135px;height:135px;object-fit:contain;display:block;margin:0 auto 8px;filter:drop-shadow(0 0 16px rgba(255,100,100,0.7));"  />`
    : '<div style="position:relative;font-size:64px;text-align:center;margin-bottom:8px;">👹</div>';
  const hearts  = '♥'.repeat(cfg.lives||2);
  const abDesc  = Object.entries(cfg.abReward||{}).map(([k,v])=>`${k}+${v}`).join(' ');

  section.innerHTML = `
    <div class="card" style="padding:16px;box-sizing:border-box;flex:1;display:flex;flex-direction:column;height:100%;">
      <div style="font-size:16px;font-weight:700;margin-bottom:12px;">📚 문제 던전 현황</div>
      <div style="${bgStyle}border-radius:var(--radius-lg);height:300px;text-align:center;position:relative;overflow:hidden;cursor:default;transition:box-shadow 0.2s,transform 0.2s;display:flex;flex-direction:column;justify-content:flex-start;padding-top:40px;"
        onmouseenter="this.style.boxShadow='0 8px 32px rgba(0,0,0,0.45)';this.style.transform='translateY(-4px)'" onmouseleave="this.style.boxShadow='';this.style.transform=''">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.38);border-radius:var(--radius-lg);pointer-events:none;"></div>

        ${monHtml}
        <div style="position:relative;font-size:18px;font-weight:800;color:#fff;margin-bottom:4px;text-shadow:0 2px 8px rgba(0,0,0,0.8);">${boss.name}</div>
        <div style="position:relative;font-size:13px;color:rgba(255,255,255,0.9);margin-bottom:4px;">📝 ${cfg.questions.length}문제 &nbsp;|&nbsp; ${hearts} 목숨 ${cfg.lives}개</div>
        <div style="position:relative;font-size:12px;color:rgba(255,255,255,0.75);margin-bottom:6px;">보상: ${cfg.reward}🪙${abDesc?' · '+abDesc:''}</div>
        ${(() => {
          const cnt = (boss.participants||[]).length;
          const clr = (boss.clearers||[]).length;
          const answered = boss.totalAnswered || 0;
          const asked = boss.totalQuestions || 0;
          const rate = asked > 0 ? Math.round(answered / asked * 100) : 0;
          return `<div style="position:relative;font-size:12px;color:rgba(255,255,255,0.7);">정답률 ${rate}% · ${cnt}명 중 ${clr}명이 최종 클리어했어요</div>`;
        })()}
      </div>
    </div>`;
}

window.fleeQuizDungeon = async function() {
  // 커스텀 confirm 모달
  const confirmed = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--surface);border-radius:16px;padding:28px 32px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="font-size:40px;margin-bottom:12px;">🏃</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:8px;">도망치시겠어요?</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-bottom:24px;line-height:1.6;">도망치면 모든 보상과 도전 기회를 잃습니다.<br>그래도 도망치겠어요?</div>
        <div style="display:flex;gap:10px;">
          <button id="fleeCancelBtn" class="btn btn-secondary btn-full">취소</button>
          <button id="fleeConfirmBtn" class="btn btn-danger btn-full">🏃 도망치기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#fleeCancelBtn').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#fleeConfirmBtn').onclick = () => { overlay.remove(); resolve(true); };
  });
  if (!confirmed) return;

  // 서버에서 직접 확인 후 참여 기록 저장
  try {
    const { getDocFromServer: gds } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const freshBoss = await gds(doc(db, 'config', 'quizDungeonBoss'));
    if (freshBoss.exists()) {
      const bossNow = freshBoss.data();
      if (!(bossNow.participants||[]).includes(state.currentUser.uid)) {
        await updateDoc(doc(db, 'config', 'quizDungeonBoss'), {
          participants: [...(bossNow.participants||[]), state.currentUser.uid]
        });
        state.quizDungeonBoss = undefined;
      }
    }
  } catch(e) {}

  // 전투 화면 종료 + 로비 복귀
  document.getElementById('quizDungeonBattle').style.display = 'none';
  document.getElementById('quizDungeonBattle').innerHTML = '';
  document.getElementById('dungeonLobby').style.display = '';
  // 로비 전체 재렌더 (탭 상태 자동 반영)
  await renderDungeonLobby();
  showToast('도망쳤어요. 도전 기회를 잃었습니다.');
};

window.startQuizDungeonFromSection = async function() {
  const cfg = await loadQuizDungeonConfig();
  if (!cfg?.questions?.length) return showToast('문제가 없어요');

  // 서버에서 직접 최신 boss 상태 확인 (캐시 무시 - 다중탭 방지 핵심)
  const { getDocFromServer, runTransaction } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const freshBoss = await getDocFromServer(doc(db, 'config', 'quizDungeonBoss'));
  if (!freshBoss.exists() || !freshBoss.data()?.active) return showToast('문제 던전이 활성화되지 않았어요');
  const bossData = freshBoss.data();
  state.quizDungeonBoss = bossData; // 캐시 최신화

  if ((bossData.participants||[]).includes(state.currentUser.uid)) return showToast('이미 참여한 문제 던전이에요');

  state.quizBattleState = {
    questions: cfg.questions,
    current: 0,
    lives: cfg.lives || 2,
    maxLives: cfg.lives || 2,
    correct: 0,
    cfg,
    done: false,
  };
  document.getElementById('dungeonLobby').style.display = 'none';
  document.getElementById('quizDungeonSection').style.display = 'none';
  document.getElementById('quizDungeonBattle').style.display = '';
  renderQuizBattle();
};

// ── 학생: 전투 렌더
function renderQuizBattle() {
  const b   = state.quizBattleState;
  const cfg = b.cfg;
  const battle = document.getElementById('quizDungeonBattle');
  if (b.done) { renderQuizResult(); return; }
  const q     = b.questions[b.current];
  const total = b.questions.length;
  const hpPct = Math.round(((total - b.correct) / total) * 100);
  const bgStyle = cfg?.bgImg ? `background-image:url('${cfg.bgImg}');background-size:cover;background-position:center;` : 'background:linear-gradient(135deg,#1e1b4b,#312e81);';
  const monHtml = cfg?.monImg ? `<img src="${cfg.monImg}" style="width:300px;height:300px;object-fit:contain;display:block;margin:0 auto;animation:monsterGlow 1.5s ease-in-out infinite alternate;" />` : '<div style="font-size:192px;text-align:center;">👹</div>';

  // 설명 문구 (첫 문제면 인트로, 이후엔 빈칸 - 피드백으로 업데이트)
  const isFirst = b.current === 0 && !b._started;

  const choiceHtml = q.type === 'multiple'
    ? `<div style="display:flex;flex-direction:column;gap:8px;">
        ${q.choices.map((c,i) => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:14px;background:var(--bg);">
            <input type="checkbox" id="qcheck_${i}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;" />
            <span>${i+1}. ${c}</span>
          </label>`).join('')}
        <button class="btn btn-primary" style="margin-top:4px;" onclick="submitQuizAnswer('multiple')">제출</button>
      </div>`
    : `<div style="display:flex;gap:8px;"><input type="text" id="quizShortInput" placeholder="정답 입력..." style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);font-size:14px;" onkeydown="if(event.key==='Enter')submitQuizAnswer('short')" /><button class="btn btn-primary" onclick="submitQuizAnswer('short')">제출</button></div>`;

  battle.innerHTML = `
    <div style="${bgStyle}border-radius:var(--radius-xl);padding:20px 24px;">
      <!-- 보스 HP -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:14px;color:rgba(255,255,255,0.9);white-space:nowrap;font-weight:600;">보스 HP</span>
        <div style="flex:1;background:rgba(0,0,0,0.4);border-radius:8px;height:14px;overflow:hidden;">
          <div style="width:${hpPct}%;height:100%;background:#ef4444;border-radius:8px;transition:width 0.5s;"></div>
        </div>
        <span style="font-size:11px;color:rgba(255,255,255,0.7);">${hpPct}%</span>
      </div>
      <!-- 몬스터 + 목숨/진행 정보 -->
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="flex-shrink:0;text-align:center;">${monHtml}</div>
        <div style="flex:1;">
          <!-- 목숨 박스 -->
          <div style="background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);border-radius:12px;padding:12px 16px;margin-bottom:8px;">
            <div style="font-size:26px;letter-spacing:4px;color:#ff1493;text-shadow:0 0 8px #ff1493,0 0 16px #ff69b4;animation:heartGlow 1.5s ease-in-out infinite alternate;">${'♥'.repeat(b.lives)}<span style="opacity:0.3;color:#888;text-shadow:none;">${'♥'.repeat(b.maxLives-b.lives)}</span></div>
            <div style="font-size:15px;color:rgba(255,255,255,0.9);margin-top:4px;font-weight:600;">남은 목숨 ${b.lives} / ${b.maxLives}</div>
          </div>
          <!-- 설명 박스 -->
          <div id="quizDescBox" style="background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);border-radius:12px;padding:10px 14px;font-size:13px;color:rgba(255,255,255,0.9);line-height:1.6;min-height:44px;font-size:16px;">
            ${isFirst ? `괴물이 깊은 잠에서 깨어나 나를 노려보기 시작한다.<br>문제를 풀어 괴물을 물리치자!` : (b._lastDesc||'')}
          </div>
        </div>
      </div>
      <!-- 진행 -->
      <div style="text-align:right;margin-top:8px;font-size:12px;color:rgba(255,255,255,0.6);">${b.current+1} / ${total} 문제</div>
    </div>
    <!-- 문제 + 선택지 -->
    <div class="card" id="quizQuestionCard" style="margin-top:16px;padding:20px;animation:questionFadeIn 0.35s ease both;">
      <div style="font-size:16px;font-weight:700;margin-bottom:16px;line-height:1.6;">${q.text}</div>
      ${choiceHtml}
      <div style="text-align:center;margin-top:16px;">
        <button onclick="fleeQuizDungeon()" style="background:none;border:1px solid #94a3b8;color:#94a3b8;padding:8px 24px;border-radius:8px;cursor:pointer;font-size:13px;display:block;width:100%;box-sizing:border-box;">🏃 도망치기</button>
      </div>
    </div>`;

  b._started = true;
  if (q.type === 'short') setTimeout(() => document.getElementById('quizShortInput')?.focus(), 100);
}

// ── 학생: 답안 제출
window.submitQuizAnswer = async function(mode) {
  const b = state.quizBattleState;
  const q = b.questions[b.current];
  // 첫 답안 제출 시 이탈 감지 플래그 설정
  b._answered = true;
  let correct = false;
  if (q.type === 'multiple') {
    // 체크된 항목과 정답 배열 비교
    const checked = q.choices.map((_,i) => !!document.getElementById(`qcheck_${i}`)?.checked);
    const answers = Array.isArray(q.answers) ? q.answers : q.choices.map((_,i) => i === q.answer);
    correct = checked.length === answers.length && checked.every((v,i) => v === answers[i]);
  } else {
    const input = document.getElementById('quizShortInput')?.value.trim().toLowerCase();
    const answers = (q.answers||[]).map(a => a.trim().toLowerCase()).filter(Boolean);
    correct = answers.includes(input);
  }

  if (correct) {
    b.correct++;
    const hpDamage = Math.round(100 / b.questions.length);
    const desc = `✅ 정답입니다! 괴물에게 맹렬한 공격을 가하여 <strong>${hpDamage}%</strong>의 체력을 깎았습니다.`;
    b.current++;
    if (b.current >= b.questions.length) {
      b.done = true;
      b._lastDesc = desc;
      await finishQuizDungeon();
    } else {
      showQuizFeedback('✅ 정답!', '#22c55e', desc);
    }
  } else {
    b.lives--;
    const desc = b.lives > 0
      ? `❌ 오답입니다. 목숨이 1개 차감됐어요. 남은 목숨: ${'♥'.repeat(b.lives)}`
      : `💀 목숨을 모두 잃었습니다...`;
    if (b.lives <= 0) {
      b.done = true;
      b.gameover = true;
      b._lastDesc = desc;
      await finishQuizDungeon();
    } else {
      showQuizFeedback('❌ 오답!', '#ef4444', desc);
    }
  }
};

function showQuizFeedback(msg, color, desc) {
  state.quizBattleState._lastDesc = desc || msg;
  const descBox = document.getElementById('quizDescBox');
  if (descBox) {
    descBox.style.color = color === '#22c55e' ? '#86efac' : '#fca5a5';
    descBox.innerHTML = desc || msg;
  }
  // 문제 카드 fadeOut 후 다음 문제 렌더
  const card = document.getElementById('quizQuestionCard');
  if (card) {
    card.style.animation = 'questionFadeOut 0.3s ease forwards';
    setTimeout(() => renderQuizBattle(), 350);
  } else {
    setTimeout(() => renderQuizBattle(), 1200);
  }
}

// ── 보상 지급 및 완료
async function finishQuizDungeon() {
  // 진행중 기록 삭제
  try { await deleteDoc(doc(db, 'config', `quizProgress_${state.currentUser.uid}`)); } catch(e) {}
  const b   = state.quizBattleState;
  const cfg = b.cfg;
  const total   = b.questions.length;
  const correct = b.correct;
  const rate    = correct / total;

  // 보상 계산
  const rewardPts  = Math.round((cfg.reward || 0) * rate);
  const lifeBonus  = b.gameover ? 0 : (b.lives * (cfg.lifeBonus || 0));
  const totalPts   = rewardPts + lifeBonus;
  const abReward   = {};
  Object.entries(cfg.abReward||{}).forEach(([k,v]) => { abReward[k] = Math.floor(v * rate); });

  // 클리어 보너스 알림 (목숨 남은 경우)
  if (!b.gameover && lifeBonus > 0) {
    const _tc = await getCfgTeacher();
    const teacherEmoji = _tc.charUrl || _tc.avatarEmoji || '👩‍🏫';
    const abMsg = Object.entries(abReward).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(' ');
    pushNotif('🎉 문제 던전 클리어!', teacherEmoji,
      `<strong>${b.correct}/${b.questions.length}</strong> 정답! (${Math.round(rate*100)}%)<br>` +
      `정답 보상: <strong>+${rewardPts}🪙</strong><br>` +
      `목숨 보너스 ${b.lives}개 남음: <strong style="color:#ff1493;">+${lifeBonus}🪙</strong><br>` +
      `총 획득: <strong style="color:var(--primary);font-size:15px;">+${totalPts}🪙</strong>` +
      (abMsg ? `<br><span style="font-size:12px;color:var(--text-secondary);">${abMsg}</span>` : '')
    );
  } else if (!b.gameover) {
    const _tc = await getCfgTeacher();
    const teacherEmoji = _tc.charUrl || _tc.avatarEmoji || '👩‍🏫';
    const abMsg = Object.entries(abReward).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(' ');
    pushNotif('🎉 문제 던전 클리어!', teacherEmoji,
      `<strong>${b.correct}/${b.questions.length}</strong> 정답! (${Math.round(rate*100)}%)<br>` +
      `총 획득: <strong style="color:var(--primary);font-size:15px;">+${totalPts}🪙</strong>` +
      (abMsg ? `<br><span style="font-size:12px;color:var(--text-secondary);">${abMsg}</span>` : '')
    );
  } else {
    const abMsg = Object.entries(abReward).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(' ');
    showToast(`던전 실패 😢 | +${totalPts}🪙${abMsg?' · '+abMsg:''} 획득`);
  }

  // 트랜잭션으로 중복 보상 완전 차단
  const { runTransaction: runTx, getDocFromServer: getFromSrv } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const bossRef = doc(db, 'config', 'quizDungeonBoss');
  let alreadyDone = false;
  try {
    await runTx(db, async (tx) => {
      const freshBoss = await tx.get(bossRef);
      if (!freshBoss.exists()) { alreadyDone = true; return; }
      const bossNow = freshBoss.data();
      if ((bossNow.participants||[]).includes(state.currentUser.uid)) { alreadyDone = true; return; }
      // 참여자 기록
      const newParticipants = [...(bossNow.participants||[]), state.currentUser.uid];
      const newClearers = b.gameover ? (bossNow.clearers||[]) : [...(bossNow.clearers||[]), state.currentUser.uid];
      tx.update(bossRef, {
        participants: newParticipants,
        clearers: newClearers,
        totalAnswered: increment(correct),
        totalQuestions: increment(total),
      });
    });
  } catch(e) { alreadyDone = true; }

  if (alreadyDone) {
    showToast('이미 처리된 던전이에요');
    renderQuizResult();
    return;
  }
  state.quizDungeonBoss = undefined; // 캐시 무효화

  // Firestore 업데이트 (포인트/능력치)
  const updateData = {
    points: increment(totalPts),
    accumulatedPoints: increment(totalPts),
  };
  Object.entries(abReward).forEach(([k,v]) => { if (v>0) updateData[`abilities.${k}`] = increment(v); });
  await updateDoc(doc(db, 'students', state.currentUser.uid), updateData);

  // history
  const abMsg = Object.entries(abReward).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(' ');
  await addDoc(collection(db, 'history'), {
    studentId: state.currentUser.uid, studentName: state.currentUser.displayName || '',
    delta: totalPts, reason: `문제 던전 (${correct}/${total} 정답)${abMsg?' ['+abMsg+']':''}`,
    type: 'plus', source: 'quizDungeon', createdAt: serverTimestamp()
  });

  window._myHistory = null; // 캐시 무효화
  renderQuizResult();
}

// ── 결과 화면 (결과창 없이 바로 로비 복귀)
async function renderQuizResult() {
  const b = state.quizBattleState;
  // 탭 즉시 비활성화
  const _qt = document.getElementById('quizDungeonTab');
  if (_qt) { _qt.style.opacity='0.55'; _qt.style.cursor='not-allowed'; _qt.style.pointerEvents='none'; _qt.classList.remove('active'); }
  const _qs = document.getElementById('quizTabStatus');
  if (_qs) _qs.innerHTML = '<span style="color:#ef4444;">✅ 이미 참여했어요</span>';

  // 결과 토스트는 finishQuizDungeon에서 이미 표시됨

  // 바로 로비 복귀
  document.getElementById('quizDungeonBattle').style.display = 'none';
  document.getElementById('quizDungeonBattle').innerHTML = '';
  document.getElementById('dungeonLobby').style.display = '';
  await renderDungeonLobby();
}
