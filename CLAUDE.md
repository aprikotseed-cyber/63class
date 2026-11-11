# 육삼레벨업 — 작업 메모

- **시험 기간:** 새 구조 입구는 `beta.html`, `index.html`은 기존 단일 파일 버전(건드리지 않음). 본 적용 = `beta.html` → `index.html` 이름 바꾸기.
- 새 Firestore 컬렉션을 쓰면 `js/backup-format.js`의 BACKUP_COLLECTIONS에도 추가 (테스트가 검사).
- 빌드 도구 없는 정적 사이트 (GitHub Pages, `main` 브랜치). `index.html` + `css/style.css` + `js/*.js` (ES 모듈).
- Firebase SDK는 CDN(gstatic, 10.12.0)에서 `js/firebase.js`가 불러오고, 다른 파일은 `./firebase.js`에서 import 해요.
- 여러 파일이 **값을 새로 대입**하는 변수는 `js/state.js`의 `state` 객체에 둬요 (`state.students = ...`). 한 파일 안에서만 바꾸는 변수는 그 파일의 `let`으로 둬요. (ES 모듈은 import 한 변수에 대입할 수 없어요.)
- HTML의 `onclick` 등에서 부르는 함수는 `window.이름 = function ...`으로 등록해요. 같은 `window.이름`을 두 파일에서 정의하지 않아요 (테스트로 검사).
- 다른 파일의 함수를 쓰면 반드시 `import { 이름 } from './파일.js?v=버전';` — 버전 문자열은 모든 파일이 같아야 해요.
- 파일을 고친 뒤: `npm run bump` → `npm test`.
- 모듈 최상위(함수 밖)에서 다른 파일의 `const`/`let`을 바로 쓰지 않아요 (순환 import 시 초기화 전 접근 오류). 시작 코드는 `js/app.js`에 둬요.
- 이미지(`levelup_*.png`)는 Firestore에 주소가 저장돼 있을 수 있으니 옮기거나 이름을 바꾸지 않아요.
- 사용자는 초등학교 6학년 담임 선생님이에요. 설명은 쉬운 말로.
