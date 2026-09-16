# IG 공개전환 모니터 (PWA + 서버)

인스타그램 계정이 비공개 → 공개로 바뀌면 아이폰(및 다른 기기)에 푸시 알림을 보내주는 웹앱입니다.
- 로그인 정보 없이 **공개 프로필 페이지의 "공개/비공개" 상태만** 확인합니다. 게시물/이미지 등 내용은 전혀 가져오지 않습니다.
- 계정 최대 100개 정도까지 안전하게 돌아가도록 분산 스케줄링 + 실패 시 백오프가 적용되어 있습니다.

## 구조
```
ig-monitor-web/
  server/     # Node.js 백엔드 (계정 관리 API + 주기적 체크 + 웹푸시 발송)
  public/     # PWA 프론트엔드 (계정/카테고리 관리 화면)
```

---

## 1. 로컬에서 먼저 테스트하기

```bash
cd server
npm install
cp .env.example .env
npm start
```

브라우저에서 `http://localhost:3000` 접속 → 계정 추가/삭제, 알림 켜기 테스트 가능.
(단, 컴퓨터를 꺼두면 당연히 멈춥니다. 24시간 감시하려면 아래 2번처럼 서버에 올려야 합니다.)

`.env.example`에는 테스트용 VAPID 키가 이미 들어있어 바로 써도 동작은 하지만,
실제로 계속 쓸 거면 아래 명령으로 본인 키를 새로 만드는 걸 권장합니다:
```bash
npx web-push generate-vapid-keys
```
나온 Public/Private Key를 `.env`에 넣으면 됩니다.

---

## 2. 24시간 서버에 올리기 (아이폰에서 계속 감지하려면 필수)

컴퓨터를 계속 켜두기 힘드니, 무료/저렴한 클라우드에 올리는 걸 추천합니다.
가장 쉬운 방법: **Render.com** (Node.js 무료 티어 제공)

1. [render.com](https://render.com) 가입 (GitHub 계정으로 가입 가능)
2. 이 `ig-monitor-web` 폴더를 본인 GitHub 저장소에 업로드
3. Render 대시보드에서 "New +" → "Web Service" → 방금 만든 저장소 선택
4. 설정:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. "Environment" 탭에서 환경변수 추가:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (위에서 생성한 값)
6. 배포 완료되면 `https://your-app.onrender.com` 같은 주소가 생김

> ⚠️ **주의**: Render 무료 플랜은 디스크가 영구 저장이 아닐 수 있어(재배포 시 초기화), 계정 목록(`server/data/accounts.json`)이 날아갈 수 있습니다. 계속 쓸 계획이면 Render의 "Persistent Disk" 옵션(유료, 월 1천원대)을 추가하거나, Railway.app / 가정용 라즈베리파이 / 저렴한 VPS(월 2천원대부터) 중 하나를 쓰는 걸 추천합니다. 어떤 방식이든 이 프로젝트 코드는 그대로 씁니다 (설정 방법만 조금씩 다름).

---

## 3. 아이폰에 설치하기

1. 아이폰 **Safari**로 배포된 주소(`https://your-app.onrender.com`) 접속
   - 반드시 Safari여야 함 (크롬 등에서는 iOS 홈화면 추가 기능이 제한적)
2. 공유 버튼(⬆️) → **"홈 화면에 추가"**
3. 홈 화면에 생긴 아이콘으로 실행 → 안의 "🔔 알림 켜기" 버튼 클릭 → 알림 허용
4. 이제 계정을 추가/관리하면 서버가 알아서 주기적으로 체크하고, 상태가 바뀌면 푸시 알림이 옵니다

> iOS는 16.4 버전 이상부터 "홈 화면에 추가한 웹앱"의 푸시 알림을 지원합니다. 그 이전 버전이면 알림 기능이 동작하지 않습니다 (설정 > 일반 > 정보에서 iOS 버전 확인 가능).

---

## 자주 묻는 것

- **계정을 몇 개까지?** 서버 쪽 로직은 100개 정도까지 안전하게 돌도록 설계되어 있습니다 (1시간 주기로 분산 체크).
- **로컬 accounts.json 백업**: `server/data/accounts.json` 파일을 복사해두면 나중에 서버 옮길 때 그대로 붙여넣어 쓸 수 있습니다.
- **페이지 구조가 바뀌어서 안 될 때**: 인스타그램이 페이지 구조를 바꾸면 `server/checker.js`의 정규식(`is_private` 추출 부분)을 손봐야 할 수 있습니다.
