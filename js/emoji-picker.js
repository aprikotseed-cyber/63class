// emoji-picker.js — 이모지 선택창
import { state } from './state.js?v=20261111a';
import { db, doc, setDoc, updateDoc } from './firebase.js?v=20261111a';
import { closeModal, openModal, showToast } from './core.js?v=20261111a';

const EMOJI_LIST_LOGO = ['🏫','🌟','🎓','🌈','🏆','🎯','📚','✏️','🖊️','🎨','🌱','🌻','🌍','🦋','🐝','🎪','🎡','🏠','🌙','☀️','🪙','💫','🔥','💡','🎵','🎶','🎮','🚀','🌺','🍀','🧩','🎭','🏅','🌠','⭐','🌊','🍃','🦚','🦜','🌴','🎋','🪴','🏔️','🌅','🌄','🌇','🎠','🎪','🧸','🪆'];
const EMOJI_CATS = {
  '😀 표정': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🫦','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  '👋 손/몸': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄'],
  '👶 사람': ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','👮','💂','🥷','👷','🫅','🤴','👸','🧙','🧝','🧛','🧟','🧞','🧜','🧚','🎅','🤶','🦸','🦹','👨‍⚕️','👩‍⚕️','👨‍🎓','👩‍🎓','👨‍🏫','👩‍🏫','👨‍⚖️','👩‍⚖️','👨‍🌾','👩‍🌾','👨‍🍳','👩‍🍳','👨‍🔧','👩‍🔧','👨‍🏭','👩‍🏭','👨‍💼','👩‍💼','👨‍🔬','👩‍🔬','👨‍🎨','👩‍🎨','👨‍🚒','👩‍🚒','🧑‍💻','🧑‍🚀','🧑‍🚒'],
  '🐶 동물': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐊','🐲','🐉','🐳','🐋','🐬','🦭','🐟','🐠','🐡','🦈','🐙','🐚','🪸','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🐾'],
  '🌸 식물/자연': ['💐','🌸','🌹','🥀','🌺','🌻','🌼','🌷','🌱','🪴','🌿','☘️','🍀','🎍','🎋','🍃','🍂','🍁','🪺','🪹','🍄','🌾','🌵','🎄','🌴','🌲','🌳','🌱','🪨','🪵'],
  '🌍 하늘/날씨': ['🌍','🌎','🌏','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','🌪️','🌫️','🌈','🌊','🌀','💧','🔥','⚡','☔','⛱️','🫧','🌙','🌛','🌜','🌚','🌝','🌞','⭐','🌟','💫','✨','☄️','🌠','🎇','🎆','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🌅','🌄','🌇','🌆','🏙️','🌃','🌌','🌉'],
  '🍎 음식': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🫘','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','🍵','☕','🫖','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'],
  '⚽ 스포츠': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🎣','🤿','🎽','🎿','🛷','🥌','🎯','🎮','🕹️','🎲','♟️','🧩','🎭','🎨','🖌️','🖍️','🎬','🎤','🎧','🎼','🎵','🎶','🪗','🎷','🎺','🎸','🪕','🎻','🥁','🪘','🎹','🪈'],
  '🏠 장소': ['🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🗺️'],
  '🚗 탈것': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛹','🛼','✈️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🚢','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋'],
  '💡 사물': ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🕹️','💾','💿','📀','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📺','📻','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','💰','💴','💵','💶','💷','💸','💳','🪙','📈','📉','📊','📋','📌','📍','📎','📏','📐','✂️','🔒','🔓','🔑','🗝️','🔨','🪓','⛏️','🛠️','⚔️','🔫','🛡️','🔧','🔩','⚙️','🧲','🪜','🧪','🧫','🧬','🔬','🔭','💊','🩹','🩺','🧴','🧷','🧹','🧺','🧻','🧼','🪥','🪒','🧽','🧯'],
  '❤️ 기호/하트': ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💝','💘','💖','💗','💓','💞','💕','💟','❣️','💔','💯','💢','💥','💫','💦','💨','💬','💭','💤','🎀','🎁','🎗️','🎟️','🎫','🎖️','🏆','🥇','🥈','🥉','🏅','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫'],
};

// 전체 아바타 목록 (카테고리 합산)
const EMOJI_LIST_AVATAR = Object.values(EMOJI_CATS).flat();

let emojiPickerTarget = null;

window.openLogoEmojiPicker = function() {
  if (!state.currentUser || state.currentUser.role !== 'teacher') return;
  emojiPickerTarget = 'logo';
  document.getElementById('emojiPickerTitle').textContent = '로고 이모지 선택';
  _renderEmojiPicker(EMOJI_LIST_LOGO, false);
  openModal('emojiPickerModal');
};

window.openAvatarEmojiPicker = function() {
  emojiPickerTarget = 'avatar';
  document.getElementById('emojiPickerTitle').textContent = '프로필 이모지 선택';
  _renderEmojiPicker(EMOJI_LIST_AVATAR, true);
  openModal('emojiPickerModal');
};

// 이모지 피커 렌더 (카테고리 탭 포함)
let _emojiCurrentList = [];
function _renderEmojiPicker(list, showCats) {
  _emojiCurrentList = list;
  const searchEl = document.getElementById('emojiSearchInput');
  if (searchEl) searchEl.value = '';
  const tabEl = document.getElementById('emojiCatTabs');
  if (tabEl) {
    if (showCats) {
      tabEl.style.display = 'flex';
      tabEl.innerHTML = `<button onclick="switchEmojiCat('__all__',this)" class="btn btn-primary" style="font-size:11px;padding:4px 8px;">전체</button>` +
        Object.keys(EMOJI_CATS).map(cat =>
          `<button onclick="switchEmojiCat('${cat.replace(/'/g,"\\'")}',this)" class="btn btn-secondary" style="font-size:11px;padding:4px 8px;">${cat}</button>`
        ).join('');
    } else {
      tabEl.style.display = 'none';
    }
  }
  _renderEmojiButtons(list);
}

window.switchEmojiCat = function(cat, btn) {
  document.getElementById('emojiSearchInput').value = '';
  document.querySelectorAll('#emojiCatTabs button').forEach(b => b.className='btn btn-secondary');
  btn.className = 'btn btn-primary';
  const list = cat === '__all__' ? EMOJI_LIST_AVATAR : (EMOJI_CATS[cat] || EMOJI_LIST_AVATAR);
  _emojiCurrentList = list;
  _renderEmojiButtons(list);
};

window.filterEmojiGrid = function(query) {
  if (!query.trim()) { _renderEmojiButtons(_emojiCurrentList); return; }
  // 카테고리 전체에서 검색
  const q = query.trim().toLowerCase();
  // 이모지 이름 매핑 (한국어 키워드)
  const keyMap = {
    '고양이':['🐱'],'강아지':['🐶'],'개':['🐶'],'곰':['🐻'],'판다':['🐼'],'여우':['🦊'],'사자':['🦁'],'호랑이':['🐯'],
    '토끼':['🐰'],'원숭이':['🐵'],'돼지':['🐷'],'소':['🐮'],'말':['🐴'],'유니콘':['🦄'],'닭':['🐔'],'오리':['🦆'],
    '독수리':['🦅'],'올빼미':['🦉'],'나비':['🦋'],'물고기':['🐟','🐠','🐡'],'고래':['🐳','🐋'],'상어':['🦈'],
    '문어':['🐙'],'거북이':['🐢'],'공룡':['🦖','🦕'],'뱀':['🐍'],'개구리':['🐸'],'벌':['🐝'],'무당벌레':['🐞'],
    '장미':['🌹'],'벚꽃':['🌸'],'해바라기':['🌻'],'튤립':['🌷'],'클로버':['🍀'],'나무':['🌲','🌳','🌴'],
    '선인장':['🌵'],'버섯':['🍄'],'별':['⭐','🌟','💫','✨'],'달':['🌙','🌛','🌜','🌚','🌝'],
    '태양':['☀️','🌞'],'무지개':['🌈'],'눈':['❄️','⛄','☃️'],'불':['🔥'],'물':['💧','🌊'],
    '번개':['⚡'],'비':['🌧️','☔'],'하트':['❤️','🧡','💛','💚','💙','💜','💗','💖','💓','💞','💕','💝'],
    '사과':['🍎','🍏'],'딸기':['🍓'],'포도':['🍇'],'바나나':['🍌'],'수박':['🍉'],'복숭아':['🍑'],
    '피자':['🍕'],'햄버거':['🍔'],'라멘':['🍜'],'초밥':['🍣'],'케이크':['🎂','🍰'],'아이스크림':['🍦'],
    '도넛':['🍩'],'커피':['☕'],'맥주':['🍺'],'포도주':['🍷'],'축구':['⚽'],'농구':['🏀'],'야구':['⚾'],
    '테니스':['🎾'],'자동차':['🚗'],'버스':['🚌'],'기차':['🚂','🚃','🚄'],'비행기':['✈️'],'로켓':['🚀'],
    '배':['🚢','⛵'],'집':['🏠','🏡'],'학교':['🏫'],'병원':['🏥'],'탑':['🗼'],'성':['🏰','🏯'],
    '책':['📚','📖'],'연필':['✏️','📝'],'가위':['✂️'],'열쇠':['🔑','🗝️'],'시계':['⌚','⏰','🕰️'],
    '전화':['📱','☎️','📞'],'컴퓨터':['💻','🖥️'],'카메라':['📷','📸'],'음악':['🎵','🎶'],
    '기타':['🎸'],'피아노':['🎹'],'드럼':['🥁'],'트럼펫':['🎺'],'바이올린':['🎻'],
    '트로피':['🏆'],'메달':['🏅','🥇','🥈','🥉'],'선물':['🎁'],'풍선':['🎈'],'리본':['🎀'],
    '폭죽':['🎇','🎆'],'반지':['💍'],'다이아':['💎'],'돈':['💰','💵','💴','💶','💷'],
    '웃음':['😀','😄','😆','🤣','😂'],'울음':['😢','😭'],'화남':['😠','😡','🤬'],
    '귀여움':['🥰','😍','🤩'],'무서움':['😱','😨','😰'],'졸림':['😴','🥱'],
    '아픔':['😷','🤒','🤕'],'멋짐':['😎'],'공부':['🤓','🧐','📚'],
  };
  let found = [];
  for (const [kw, emojis] of Object.entries(keyMap)) {
    if (kw.includes(q) || q.includes(kw)) found.push(...emojis);
  }
  // 직접 이모지 문자 포함 여부도 체크
  found.push(...EMOJI_LIST_AVATAR.filter(e => e.includes(q)));
  // 중복 제거
  found = [...new Set(found)].filter(e => EMOJI_LIST_AVATAR.includes(e));
  _renderEmojiButtons(found.length ? found : EMOJI_LIST_AVATAR);
};

function renderEmojiGrid(list) { _renderEmojiPicker(list, list === EMOJI_LIST_AVATAR); }

function _renderEmojiButtons(list) {
  document.getElementById('emojiGrid').innerHTML = list.map(e => `
    <button onclick="selectEmoji('${e}')" title="${e}"
      style="font-size:26px;padding:6px;border:1.5px solid transparent;border-radius:var(--radius-sm);
      background:none;cursor:pointer;transition:all 0.15s;line-height:1;"
      onmouseover="this.style.background='var(--bg)';this.style.borderColor='var(--primary)'"
      onmouseout="this.style.background='none';this.style.borderColor='transparent'">${e}</button>
  `).join('');
}

window.selectEmoji = async function(emoji) {
  closeModal('emojiPickerModal');
  if (emojiPickerTarget === 'logo') {
    document.getElementById('navLogo').textContent = emoji;
    const lp = document.getElementById('logoPreview');
    if (lp) lp.textContent = emoji;
    // 교사라면 바로 저장
    if (state.currentUser && state.currentUser.role === 'teacher') {
      const title = document.getElementById('navTitle').textContent;
      await setDoc(doc(db, 'config', 'site'), { logo: emoji, title }, { merge: true });
      showToast('로고가 변경됐어요 ✅');
    }
  } else if (emojiPickerTarget === 'avatar') {
    const navAvatar = document.getElementById('navAvatar');
    navAvatar.textContent = emoji;
    navAvatar.style.background = 'transparent';
    navAvatar.style.color = '';
    navAvatar.style.fontSize = '22px';
    // 설정 화면 미리보기도 업데이트
    const sp = document.getElementById('settingAvatarPreview');
    if (sp) sp.textContent = emoji;
    // Firestore에 저장 (학생: students 컬렉션, 교사: config/teacher)
    try {
      if (state.currentUser.role === 'student') {
        await updateDoc(doc(db, 'students', state.currentUser.uid), { avatarEmoji: emoji });
      } else {
        await setDoc(doc(db, 'config', 'teacher'), { avatarEmoji: emoji }, { merge: true });
      }
      showToast('프로필 이모지가 변경됐어요 ✅');
    } catch(e) { console.error(e); }
  }
};
