// state.js — 여러 파일이 함께 바꾸는 공용 상태
// 여러 파일에서 값을 새로 바꾸는 변수는 여기 모아 두고 state.이름 으로 씁니다.

export const state = {
  // core.js
  currentUser: null, // { role: 'teacher'|'student', name, uid }
  students: [],
  rewards: [],
  exchanges: [],
  messages: [],
  currentExchangeFilter: 'pending',
  selectedMessageId: null,
  pendingRewardEdit: null,
  pendingExchangeId: null,
  changePwTargetId: null,
  unsubMessages: null,
  unsubStudents: null, // onSnapshot 리스너 핸들러
  unsubExchanges: null,
  unsubRewards: null,
  _cfgTeacher: null,
  // dungeon-admin.js
  dungeonConfig: null, // Firestore에서 로드한 설정
  battleState: null, // 현재 전투 상태
  // quiz-dungeon.js
  quizDungeonConfig: null, // 세션 캐시
  quizDungeonBoss: undefined, // 활성화 상태 캐시 (undefined=미로드, null=없음)
  quizBattleState: null, // 진행 중인 전투 상태
  // avatar.js
  avatarEquipped: {}, // { category: itemId } (저장된 값)
  avatarEquippedMeta: {}, // { category: { ext } } (ext 정보)
  avatarPreviewEquip: {}, // { category: itemId } (미리보기용)
  // pets.js
  petList: [], // 전체 펫 목록 (config/pets)
  petInventory: new Set(), // 보유한 펫 ID Set
};
