---
name: sentry-noise-filter
description: Sentry에 잡힌 환경/브라우저/외부 의존성 발 노이즈 에러를 필터링한다. 사용자가 "Sentry 노이즈", "Sentry 에러 필터", "이 에러 무시", "Sentry에 자꾸 뜨는 X 막아줘" 등을 요청할 때 발동한다.
---

# Sentry 노이즈 필터 추가

차량 운행일지 프로젝트에서 가장 빈번한 보수 작업 중 하나. 최근 30개 커밋 중 5건 이상이 "Sentry 노이즈 필터링" 관련이다. 단순해 보이지만 **"앱 버그"와 "환경 노이즈"의 판단**이 핵심이며, 잘못 필터링하면 진짜 버그가 묻힌다.

## 발동 조건

- 사용자가 특정 에러 메시지·정규식을 보여주며 "Sentry에서 이거 좀 막아줘"라고 함
- "Sentry 노이즈가 너무 많다", "이 에러는 우리 버그 아님" 등
- App Check, IndexedDB, ServiceWorker, 인앱 브라우저 관련 환경 에러 보고

## 절대 원칙

**필터링 전에 "정말 앱 버그가 아닌지" 한 번 더 검증한다.** 잘못 필터링하면 회귀를 못 잡는다. 다음 중 하나에 해당할 때만 필터링:

1. 브라우저/OS/네트워크 환경 이슈 (특정 사용자 환경에서만 재현, 코드로 해결 불가)
2. 외부 SDK 내부 에러 (Firebase, reCAPTCHA, vite-plugin-pwa 등)
3. 브라우저 확장 프로그램·인앱 브라우저(Facebook, Kakao 등) 발 에러
4. 앱 코드에서 이미 catch되어 정상 처리되는 비즈니스 에러 (글로벌 바운더리로 새는 것만 차단)

코드로 고칠 수 있거나 빈도가 낮으면 **고치는 게 우선**이다. 필터는 최후의 수단.

## 어디에 추가하나

### 프론트엔드: [src/lib/sentry.ts](src/lib/sentry.ts)

세 곳 중 한 곳을 고른다:

**(A) `ignoreErrors` 배열** — 에러 메시지 정확/정규식 매칭으로 차단:

```ts
ignoreErrors: [
    // ... 기존 항목 ...
    // [추가 이유 한 줄: 환경 이슈/외부 SDK/등]
    /새-에러-정규식/,
],
```

문자열 그대로 포함 매칭하려면 `'에러 메시지 일부'` (따옴표 문자열), 패턴이면 정규식.

**(B) `denyUrls` 배열** — 특정 URL/스택트레이스 출처 차단 (브라우저 확장 등):

```ts
denyUrls: [
    /extensions\//i,
    /^chrome-extension:\/\//i,
    // ...
],
```

**(C) `beforeSend` 훅** — 메시지만으로 안 잡히는 복잡한 케이스 (스택프레임 검사, DOMException 코드 등):

```ts
beforeSend(event) {
    if (import.meta.env.DEV) return null;

    // 새 조건: 짧은 이유 주석 (필수)
    const errorMsg = event.exception?.values?.[0]?.value || '';
    if (/패턴/.test(errorMsg)) return null;

    return event;
},
```

선택 기준:
- 메시지 문자열·정규식으로 충분 → **(A) ignoreErrors**
- 특정 도메인/URL 발 → **(B) denyUrls**
- 메시지가 너무 일반적이고 스택트레이스·이벤트 메타데이터로 구분해야 함 → **(C) beforeSend**

### Cloud Functions: [functions/src/sentry.ts](functions/src/sentry.ts)

Functions 측은 `Sentry.init` 옵션에 `ignoreErrors`/`beforeSend`를 추가할 수 있지만, 현재 구현은 **모든 에러를 `captureError(err, ctx)` 헬퍼를 통해 명시적으로 전송**하는 구조다. 즉 호출자가 try/catch에서 노이즈를 판단해 `captureError`를 호출하지 않으면 된다.

Functions에서 노이즈 필터가 필요한 경우 두 가지 패턴:

1. **호출부에서 분기** (선호) — 에러 종류를 판별해 `captureError`를 건너뛴다.
   ```ts
   try { /* ... */ } catch (err) {
       if (isExpectedTransientError(err)) {
           console.warn("transient, skip sentry", err);
           return;
       }
       captureError(err, { context });
       throw err;
   }
   ```
2. **`sentry.ts`의 `getSentry().init`에 `beforeSend` 추가** — 광범위한 패턴일 때만.

선택 기준: 특정 함수에 국한된 노이즈면 (1), 시스템 전반에 퍼진 패턴이면 (2).

## 작성 체크리스트

- [ ] 필터 추가 라인 위에 **이유 주석 한 줄** 필수 (다른 항목들과 톤 통일: "X 발생 — Y 이유로 앱 버그 아님")
- [ ] 정규식이면 너무 광범위하지 않은지 검토 (예: `/error/i`는 금지). 가능한 한 좁게.
- [ ] 비즈니스 에러를 필터링하는 거라면 **앱 코드 측에서도 사용자 메시지로 정상 처리되는지** 먼저 확인. 글로벌 바운더리로 새지 않으면 필터 불필요.
- [ ] 추가 후 `npm run type-check`로 정규식·문자열 오타 없는지 확인.
- [ ] 커밋 메시지: `chore: sentry [필터-주제] 노이즈 필터링 추가` 또는 `fix: suppress sentry [주제]`.

## 자주 본 카테고리 (이미 필터링된 것들)

[src/lib/sentry.ts](src/lib/sentry.ts)의 기존 항목을 카테고리별로 확인 후 중복 추가 방지:

- ResizeObserver / Non-Error promise / Network failed
- ChunkLoadError, Loading chunk failed (배포 후 구버전 청크)
- Firebase: unavailable, internal, Connection failed, IDB INTERNAL ASSERTION
- App Check / reCAPTCHA timeout, throttled
- iOS Safari: Pending promise was never set, IndexedDB lost
- Facebook 인앱 브라우저: Java object is gone, webkit.messageHandlers
- vite-plugin-pwa: newestWorker is null, Cannot update a null
- 비즈니스: "동일한 운행 기록이 이미 존재합니다" 등

같은 카테고리의 유사 패턴이면 기존 항목 옆에 묶어서 추가.

## 안티패턴

- 메시지에 ID·UID·시간 등 유동 값이 포함된 정규식 (`/user-[a-z0-9]+ failed/`) — 운영에서 깨짐
- `/.*error.*/i` 같은 광범위 패턴 — 진짜 버그 같이 묻힘
- "일단 무시" 주석 — 6개월 뒤 누구도 못 건드림. 이유와 출처(브라우저/SDK/시나리오)를 명시
