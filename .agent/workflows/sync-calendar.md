---
description: 구글 캘린더 OAuth 인증 및 양방향 예약 동기화를 로컬 에뮬레이터에서 검증·디버깅
---

# 🔄 구글 캘린더 연동 및 동기화 검증 워크플로우

이 워크플로우는 구글 캘린더 OAuth 인증 및 양방향 예약 동기화 기능을 로컬 에뮬레이터 환경에서 검증하고 디버깅하기 위한 단계별 수행 절차를 안내합니다.

---

## 1. 사전 요구사항

1.  **Firebase Emulator 실행**: Firestore, Functions, Auth 에뮬레이터가 구동 중이어야 합니다.
2.  **구글 OAuth API 자격 증명 설정**:
    *   Google Cloud Console ➔ API 및 서비스 ➔ OAuth 동의 화면 및 사용자 인증 정보 설정
    *   리디렉션 URI에 `http://localhost:5001/{project-id}/asia-northeast3/oauthCallback` 등록 필수

---

## 2. 테스트 환경 구성 및 에뮬레이터 실행

### Step 1: 로컬 에뮬레이터 실행
터미널에서 에뮬레이터를 백그라운드로 실행합니다. (또는 `/dev` 워크플로우 참고)
```bash
# Firebase Emulator 구동 (Auth, Firestore, Functions 포함)
firebase emulators:start --only auth,firestore,functions
```

### Step 2: 로컬 환경 변수 확인
`functions/.env.local` 또는 `.env.emulator`에 아래 설정들이 올바르게 기입되었는지 확인합니다.
```env
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
```

---

## 3. 동기화 시나리오 검증 절차

### Step 3: OAuth 토큰 발급 및 리디렉션 흐름 테스트
1.  브라우저를 열고 로그인(Auth) 후, 설정 페이지에서 **"구글 캘린더 연동"** 버튼을 클릭합니다.
2.  구글 OAuth 페이지로 이동하여 권한을 수락하면, 로컬 Functions 콜백인 `/oauthCallback`으로 갱신 토큰(Refresh Token)과 액세스 토큰(Access Token)이 정상 전달되는지 콘솔 로그를 확인합니다.
3.  Firestore의 `users/{uid}/secure/oauth` 문서에 토큰 데이터가 암호화되어 안전하게 저장되었는지 Firestore 에뮬레이터 UI(`http://localhost:4000/firestore`)에서 검증합니다.

### Step 4: Firestore ➔ 구글 캘린더 동기화 수동 검증
1.  차량 예약이 신규 등록되거나 변경되었을 때, Cloud Functions의 Firestore 트리거가 작동하여 구글 API를 호출하는 과정을 테스트합니다.
2.  트리거 로직을 수동으로 구동하기 위해 아래 테스트 스크립트를 실행해 봅니다.
    ```bash
    # 예약 동기화 수동 테스트 스크립트 실행
    npx tsx scripts/test-calendar-sync.ts --uid={test-uid} --reservationId={test-res-id}
    ```
3.  구글 캘린더(실제 테스트용 계정)를 열고 예약 내용(예약자명, 사용 차량명, 목적지, 시간)이 이벤트로 추가되었는지 육안으로 확인합니다.

### Step 5: 구글 캘린더 ➔ Firestore 양방향 동기화(Webhook) 테스트
구글 캘린더에서 이벤트가 수정되었을 때, Firebase Functions의 HTTP 트리거가 알림을 수신하여 Firestore 예약을 역으로 업데이트하는 양방향 시나리오입니다.
1.  구글 Webhook 알림은 로컬 호스트(`localhost`)로 직접 들어올 수 없으므로, **ngrok** 등의 터널링 도구를 켭니다.
    ```bash
    # ngrok 터널링 생성 (5001번 포트 기준)
    ngrok http 5001
    ```
2.  ngrok 호스트 주소(예: `https://abcd.ngrok-free.app`)를 구글 캘린더 Webhook 채널 등록(Watch) 정보로 설정하고 테스트를 구동합니다.
3.  구글 캘린더에서 이벤트를 수정했을 때 ngrok 터널을 타고 Functions로 수신되는 웹훅 로그(`http://localhost:4000/logs`)를 분석합니다.
