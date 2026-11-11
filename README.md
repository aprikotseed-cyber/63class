# 육삼레벨업

게이미피케이션 기반 학급경영 홈페이지예요. 학생은 출석·1인1역·칭찬 카드로 포인트와 능력치를 모으고, 레벨을 올리고, 보상 상점·꾸미기(프레임·아바타·칭호·펫)·던전에 참여해요. 선생님은 학생 관리, 카드 부여, 보상 승인, 누가기록, 게시판·쪽지 등을 한곳에서 관리해요.

- 데이터: Firebase (인증 + Firestore)
- 배포: GitHub Pages (`main` 브랜치의 파일이 그대로 사이트가 돼요, 빌드 과정 없음)

## 데이터 백업

선생님으로 로그인 → 학생 관리 → **💾 전체 데이터 백업**. 모든 데이터를 `63levelup-backup-날짜.json` 파일로 내려받아요 (읽기만 하고 데이터는 바꾸지 않아요).

## 비밀번호와 보안 (2026-11 개편)

- 선생님 비밀번호는 데이터베이스에 저장하지 않아요. Firebase 로그인이 직접 확인해요.
- 학생 비밀번호 기록은 학생 문서가 아니라 **선생님만 읽을 수 있는 보관함**(`studentSecrets`)에 있어요.
- 학생 추가·비밀번호 변경·계정 점검은 "보조 로그인 창구"로 처리해서 선생님 로그인이 풀리지 않아요.
- 학생은 내 설정에서 비밀번호를 직접 바꿀 수 있고, 바꾼 비밀번호는 선생님 보관함에도 기록돼요.

### 보안 규칙 적용 순서 (한 번만)

1. 이 버전을 `main`에 합치고 사이트에서 새 버전이 뜨는지 확인 (학생 관리에 🧹 데이터 정리 버튼)
2. 학생 관리 → **💾 전체 데이터 백업**
3. 학생 관리 → **🧹 데이터 정리** → 검사하기 → 최소한 **🔐 비밀번호 기록 보호**를 체크하고 실행
4. Firebase 콘솔 → Firestore Database → **규칙(Rules)** 탭
   - 지금 들어 있는 규칙을 메모장에 복사해 두기 (되돌릴 때 필요)
   - 저장소의 `firestore.rules` 내용을 통째로 붙여 넣고 **게시**
5. 선생님·학생 로그인이 잘 되는지 확인. 문제가 있으면 4번에서 복사해 둔 규칙으로 되돌려 게시

※ 백업 파일에는 학생 비밀번호 기록도 들어 있어요. 다른 곳에 올리거나 공유하지 마세요.

## 읽기 사용량 확인

사이트에서 F12(개발자 도구) → Console 에 `rsum()` 을 치면, 화면을 연 뒤 어디서 문서를 몇 개 읽었는지 많은 순서로 보여줘요 (Firestore 요금 기준, 실시간 구독 포함).

### 색인 하나 만들면 더 줄어요 (선택)

학생 "내 능력치" 화면의 포인트 내역은 최근 10개만 읽도록 바꿨어요. 이 방식은 Firestore 복합 색인이 하나 필요해요.
색인이 없으면 예전처럼 내역 전체를 읽어서 똑같이 보여줘요 (오류 없음). 만드는 법:

1. 학생으로 로그인 → 내 능력치 화면 → F12 → Console 에 나온 노란 경고의 `https://console.firebase.google.com/...` 링크를 눌러요
2. 열린 Firebase 화면에서 **색인 만들기** → 몇 분 기다리면 끝

(설정 내용은 `firestore.indexes.json` 에 적어 뒀어요: history 컬렉션, studentId 오름차순 + createdAt 내림차순)

## 구조

```
index.html          화면 뼈대 (페이지·모달 HTML)
css/style.css       디자인
js/app.js           시작점: 모든 기능을 불러오고 자동 로그인 처리
js/firebase.js      Firebase 연결 (앱·인증·DB) + 읽기 횟수 추적 (콘솔에서 rsum())
js/state.js         여러 파일이 함께 바꾸는 공용 상태 (state.currentUser, state.students …)
js/core.js          전역 상수, 설정 캐시, 공통 유틸(토스트·모달)
js/ui.js            화면 공통 (탭 페이드, 사이드바, 로딩)
js/level.js         레벨·랭크 계산, 랭크업 체크

로그인·진입
js/auth.js          로그인(교사/학생), 자동 로그아웃, 교사 비밀번호 변경
js/enter.js         로그인 후 앱 진입, 대기 중 알림 확인, 로그아웃
js/nav.js           페이지 이동(네비게이션)
js/realtime.js      교사 데이터 로드, 알림 큐, Firestore 실시간 리스너
js/site-config.js   사이트 설정(로고·배경), 교사 프로필 캐릭터
js/student-view.js  교사의 학생 뷰 전환

교사 관리
js/dashboard.js     교사 대시보드
js/students.js      학생 목록·포인트/능력치 수정·일괄 추가
js/student-detail.js 학생/친구 상세 보기
js/admin.js         데이터 초기화, 학생 계정 관리·재생성·마이그레이션
js/checklist.js     체크표 시스템

학급 활동
js/home.js          홈 화면(간판, 교사/학생 랭킹)
js/attendance.js    출석 체크, 주간 출석 현황
js/roles.js         1인1역 시스템
js/role-auction.js  1인1역 경매
js/board.js         자유게시판
js/notice.js        공지사항
js/messages.js      쪽지 (교사/학생)
js/books.js         독서량, 독서 완료 카드
js/crowdfunding.js  크라우드펀딩
js/backup.js        전체 데이터 백업 (교사)
js/cleanup.js       데이터 정리 도구 (교사)
js/cleanup-plan.js  정리 대상 판단 (순수 함수, 테스트)
js/accounts.js      학생 계정·비밀번호 기록 (보조 로그인 창구, 보관함)
js/backup-format.js 백업 파일 형식·컬렉션 목록

포인트·보상
js/cards.js         칭찬/벌점 카드 관리·부여·내역·회수
js/points.js        학생: 내 포인트
js/shop.js          보상 상점·보상 관리·할인·재고 현황
js/exchanges.js     보상 교환 신청 관리
js/inventory.js     내 보관함 (보상·칭호·꾸미기·아바타)

꾸미기
js/frames.js        프레임 시스템 (상점·추가·수정)
js/avatar.js        아바타 시스템 (데이터·교사 관리)
js/avatar-shop.js   아바타 상점 (학생)
js/titles.js        칭호 시스템 (목록·관리·회수·선물·장착)
js/pets.js          펫 시스템
js/emoji-picker.js  이모지 선택창
js/profile.js       학생 설정·비밀번호·프로필 메시지

던전
js/dungeon.js       챌린지 던전 (학생: 로비·전투·단체 던전)
js/dungeon-admin.js 던전 관리 (교사: 설정·이미지 라이브러리·보스)
js/quiz-dungeon.js  문제 던전

firestore.rules           Firestore 보안 규칙 (콘솔에 붙여 넣기)
scripts/bump-version.mjs  파일 버전(?v=) 한꺼번에 올리기
tests/                    파일 연결·버전 검사
```

화면의 버튼(`onclick="..."`)이 부르는 함수는 각 파일에서 `window.함수이름 = ...`으로 등록돼 있어요.

## 고치고 올리기

1. 파일 수정
2. `npm run bump` — 휴대폰·태블릿이 예전 파일을 쓰지 않도록 버전을 올려요
3. `npm test` — 파일끼리 주고받는 이름이 맞는지 확인해요 (처음 한 번 `npm install`)
4. 커밋 후 `main`에 합치면 GitHub Pages에 반영돼요

## 내 컴퓨터에서 열어 보기

`js/`가 모듈 방식이라 파일을 더블클릭하면 안 열려요. 저장소 폴더에서 아래를 실행하고 http://localhost:8000 으로 열어요.

```
python3 -m http.server 8000
```
