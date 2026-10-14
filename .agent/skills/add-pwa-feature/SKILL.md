---
name: add-pwa-feature
description: "PWA 기능, 서비스워커 및 오프라인 상태 관련 로직을 추가하는 패턴 가이드"
---

# add-pwa-feature 가이드

오프라인 우선주의(Offline-First) 및 PWA(Progressive Web App) 앱 업데이트를 처리하기 위한 스킬입니다. 차량운행일지는 환경 특성상 탭 오프라인 지원이 핵심 과제 중 하나입니다.

## 1. 네트워크 감지 패턴
단순히 `navigator.onLine`만을 사용하는 것을 지양합니다. 상태 관리를 통해 전역으로 UI를 핸들링합니다.

실제 구현은 [OfflineBanner.tsx](../../../src/components/common/OfflineBanner.tsx)가 `online`/`offline` 이벤트로 직접 처리한다(전용 훅은 없다). 여러 곳에서 필요해지면 아래 모양의 훅으로 추출한다.

```typescript
// 추출할 때의 예시 (현재 저장소에는 없는 파일)
import { useState, useEffect } from 'react';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
```

## 2. PWA 서비스워커 업데이트 방식
서비스워커는 `vite-plugin-pwa`의 **injectManifest** 전략으로 직접 작성한다 — 원본은 [src/sw.ts](../../../src/sw.ts)이고
설정은 `vite.config.js`의 `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'autoUpdate' })`다.
`registerSW.js` 같은 생성 파일은 쓰지 않는다.

1. **업데이트 반영**: `registerType: 'autoUpdate'` + [src/lib/swUpdate.ts](../../../src/lib/swUpdate.ts)가 새 워커를 받아 다음 화면 이동에서 반영한다(작성 중인 내용을 지우지 않으려고 즉시 새로고침하지 않는다).
2. **배포 직후 구버전 탭**: 지연 로드 청크가 사라져 실패하면 [src/lib/staleChunk.ts](../../../src/lib/staleChunk.ts)의 `STALE_CHUNK_MESSAGE`로 안내한다 — 토스트 스토어가 이 문구일 때만 [새로고침] 버튼을 붙인다.
3. **서비스워커에서 Firestore에 쓰지 않는다**: 서비스워커에는 App Check가 없고 Firestore는 App Check ENFORCED다. 쓰기는 페이지에서만 한다(`sw.ts`의 `sync` 주석).

## 3. 에이전트 행동 지침
- "오프라인에서도 글 작성 되게 해줘"라는 요청을 받으면, **새 저장소를 만들지 말고 기존 오프라인 큐를 쓴다** — [src/lib/offline/syncQueue.ts](../../../src/lib/offline/syncQueue.ts)(`idb` 기반 `enqueue`·`flushQueue`, 같은 문서 순서 보장·재시도 냉각·폐기 안내)와 [syncFailureNotice.ts](../../../src/lib/offline/syncFailureNotice.ts). `dexie` 등 새 라이브러리는 들이지 않는다(D15).
- 단순히 UI만 바꾸지 말고, 오프라인 시 Firebase Sync 지연(Timeout)을 우회/재시도(`useRetry`)하는 설계를 병행해야 합니다.

## 관련 문서
- [offline-first 룰](../../rules/offline-first.md): 오프라인 우선주의 체크 규칙
- [pwa-mobile-first 룰](../../rules/pwa-mobile-first.md): PWA 모바일 우선 개발 원칙
