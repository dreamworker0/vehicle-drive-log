---
description: Firebase Auth 토큰 만료 및 갱신, 세션 유지와 관련된 복원력(Resilience) 가이드라인.
---

# 🛡️ 인증 토큰 복원력 규칙 (Token Auth Resilience)

차량운행일지 앱은 모바일 브라우저(Samsung Internet, iOS Safari 등)에서 주로 사용되며, 백그라운드로 전환되었다가 돌아올 때 Firebase 인증 토큰이 만료되거나 세션이 유실될 위험이 높다. 이에 대응하기 위해 아래 규칙을 준수한다.

## 1. 세션 유지 (Persistence) 설정

- `src/lib/firebase.ts`에서 Auth 인스턴스 초기화 시 명시적으로 `browserLocalPersistence`를 설정한다.
- iOS Safari ITP(Intelligent Tracking Prevention)로 인해 세션 유지가 꼬이는 것을 방지하기 위해, 초기 렌더링을 차단하더라도 `setPersistence`가 완료된 후 상태 구독을 시작하도록 설계한다.

## 2. 토큰 강제 갱신 로직 (Token Refresh)

Cloud Functions 등 백엔드 API를 호출하기 직전에 토큰 만료 여부를 검사하고 필요 시 능동적으로 갱신해야 한다.
- `src/lib/tokenRefresh.ts`의 유틸리티(예: `ensureValidToken`)를 활용하여 현재 로그인된 유저의 토큰을 점검한다.
- 강제 갱신이 빈번하게 일어나지 않도록 일정 시간(예: 5분 이내) 만료 예정인 경우에만 `user.getIdToken(true)`를 호출한다.

## 3. 인증된 HTTP 요청 (authFetch)

직접 `fetch` API를 통해 백엔드(예: Cloud Functions, Tmap 등 내부 프록시)와 통신할 때는 반드시 인증 토큰을 헤더에 포함시켜야 한다.
- 생 `fetch` 대신 `src/lib/authFetch.ts`에 정의된 래퍼 함수를 사용한다.
- `authFetch` 내부에는 **[토큰 갱신 로직] → [헤더에 Bearer 주입] → [401 응답 시 에러 처리]** 가 구현되어 있다.

## 4. 백엔드(Cloud Functions)의 타임아웃 방어

모바일 네트워크 지연으로 인해 토큰 검증이나 API 연동이 길어질 수 있다.
- 중요 트랜잭션 함수(예: `createReservationSafe`, 결제, 알림톡 전송 등)는 기본 타임아웃을 `60초` 이상으로 설정한다.
- Firebase `deadline-exceeded` 에러를 피하기 위해 무거운 로직 앞단에서 충분한 여유 시간을 할당한다.

## 5. UI/UX 피드백

- 토큰이 유효하지 않아 `FirebaseError: Unauthenticated` (또는 401/403) 오류가 반환되었을 경우:
  - 브라우저 스토리지에서 세션을 비우거나, 자연스럽게 재로그인 페이지로 유도해야 한다.
  - 단순히 "에러 발생" 토스트만 띄운 채로 무한 루프에 빠지게 두어서는 안 된다.
