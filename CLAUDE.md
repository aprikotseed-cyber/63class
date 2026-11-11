# 육삼레벨업 — 작업 메모

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
- 읽기 사용량: Firestore 조회를 새로 넣을 때 컬렉션 전체(`getDocs(collection(...))`)를 읽지 말고 날짜 범위(`where('date','>=',..)`)나 같은 값 조건으로 좁혀요. 같다(==) 조건끼리나 한 필드의 범위 조건은 색인이 필요 없지만, 다른 필드의 범위/정렬을 섞으면 복합 색인이 필요해요 (없으면 오류 → 대비 코드 필요).
- `rsum()` (js/firebase.js)이 문서 단위로 읽기를 세요. 개선 전후 비교에 써요.
- 비밀번호: 학생 비밀번호 기록은 `studentSecrets/{학생ID}` (js/accounts.js). 학생 문서에 `pwHint`를 쓰지 않아요. 선생님 비밀번호는 어디에도 저장하지 않아요.
- 선생님 화면에서 학생 계정으로 로그인/생성할 때는 반드시 `getHelperAuth()`(보조 창구)를 써요. 기본 `auth`로 하면 선생님 로그인이 학생으로 바뀌어요.
- 보안 규칙은 `firestore.rules` (콘솔에 직접 붙여 넣음). 새 컬렉션은 로그인 사용자 전체 허용 규칙에 걸려요. 비밀 데이터는 studentSecrets 처럼 따로 match 를 둬요.
