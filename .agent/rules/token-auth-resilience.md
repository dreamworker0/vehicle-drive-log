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

## 6. 구글 로그인 왕복은 에뮬레이터·E2E로 검증되지 않는다 — 프로덕션 확인 전 머지 금지

`signInWithRedirect` 경로는 **나가는 절반(구글로 이동)과 돌아오는 절반(복귀 결과 소비)이
서로 다른 장치로 동작한다.** 그런데 우리 자동 검증은 둘 다 타지 않는다.

- E2E는 Auth 에뮬레이터의 이메일/비밀번호(`__E2E_AUTH__`)로 로그인하므로 리다이렉트
  왕복이 아예 없다.
- 미리보기 채널(`vehicle-drive-log--pr-N-*.web.app`)은 **API 키의 HTTP 리퍼러 제한**에
  걸려 로그인을 완료할 수 없다(`auth/requests-from-referer-...-are-blocked`). 나가는
  절반까지만 보인다.
- 단위 테스트로는 "리졸버를 인자로 넘겼는가"까지만 고정할 수 있고, "복귀 결과를 누가
  소비하는가"는 고정되지 않는다.

따라서 **auth 초기화·로그인 경로를 건드리는 변경은 프로덕션에서 실제 구글 로그인 왕복을
확인한 뒤에만 머지한다.** CI 초록은 이 경로에 대한 증거가 아니다. 확인이 불가능하다면 그
변경은 하지 않는다 — 랜딩 성능 몇백 ms를 위해 로그인을 걸 이유는 없다.

### 2026-08-24 사고 (#224 → #225로 회수)

랜딩에서 `apis.google.com/js/api.js`를 받지 않으려고 `getAuth()`를 리졸버 없는
`initializeAuth`로 바꿨다. 그런데 `popupRedirectResolver`는 "대기 중인 리다이렉트가
있는지 확인"만 하는 장치가 아니라 **돌아온 리다이렉트를 초기화 시점에 완료시키는**
장치였다. 떼는 순간 복귀 결과를 소비하는 주체가 사라졌고(`lightEntry` 경로에는
`getRedirectResult` 호출이 없다 — `useAuth`는 인증 사용자용 `appEntry`에서만 마운트된다),
프로덕션 로그인이 **에러 한 줄 없이** 실패했다. 콘솔에 Firebase 오류가 없는 것이 특징이다
— 실패가 아니라 아무 일도 일어나지 않은 것이다.

되살리려면 복귀 시점에 `getRedirectResult(auth, browserPopupRedirectResolver)`를 부르는
주체를 `lightEntry` 경로에 명시적으로 두고(리다이렉트 시작 시 세션 저장소에 표식, 부팅 시
소비), 프로덕션 왕복을 확인한 뒤 머지한다.

## 7. 구글 로그인은 `prompt: 'select_account'`를 고정한다

`googleProvider`에 `prompt`를 지정하지 않으면, 브라우저에 활성 Google 세션이 **하나뿐일 때 Google이 계정 선택 화면을 건너뛰고** 그 계정으로 바로 인증시킨다. 앱의 `logout()`은 Firebase 세션·오프라인 큐·Firestore 캐시를 지우지만 **Google 쪽 브라우저 세션은 권한 밖이라 지울 수 없다** — 그래서 "다른 계정으로 로그인" 버튼이 실질적으로 동작하지 않았다(구현이력 Phase 127).

```ts
googleProvider.setCustomParameters({ prompt: 'select_account' });
```

- `googleProvider`는 `src/lib/firebase.ts`에서 한 번만 만들어지고, `src/lib/auth.ts`의 popup/redirect 분기가 **같은 provider를 공유**하므로 이 한 줄로 양쪽이 함께 덮인다
- 부수 효과로 **기관 공용 기기**에서 직전 사용자 계정으로 무의식 재로그인되던 것도 막힌다(비용은 재로그인 시 클릭 1회)
- **`prompt: 'consent'`는 쓰지 않는다** — 매번 동의 화면까지 띄워 과하다
- 이 설정은 Google이 띄우는 화면만 바꾸므로 리다이렉트 복귀 메커니즘에는 영향이 없다
- ⚠️ 계정 선택 화면은 **외부 도메인이라 E2E로 검증할 수 없다.** §6과 같은 이유로 실기기 확인이 필요하다

