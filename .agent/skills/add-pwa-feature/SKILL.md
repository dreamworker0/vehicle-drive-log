---
name: "add-pwa-feature"
description: "PWA 기능, 서비스워커 및 오프라인 상태 관련 로직을 추가하는 패턴 가이드"
---

# add-pwa-feature 가이드

오프라인 우선주의(Offline-First) 및 PWA(Progressive Web App) 앱 업데이트를 처리하기 위한 스킬입니다. 차량운행일지는 환경 특성상 탭 오프라인 지원이 핵심 과제 중 하나입니다.

## 1. 네트워크 감지 패턴
단순히 `navigator.onLine`만을 사용하는 것을 지양합니다. 상태 관리를 통해 전역으로 UI를 핸들링합니다.

```typescript
// src/hooks/useNetworkStatus.ts (권장 훅 사용 예시)
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
서비스워커(`registerSW.js` 또는 `pwa-plugin` 설정 파일)의 캐시된 리소스를 날리고 최신 버전을 적용해야 할 때 다음과 같은 패턴을 권장합니다.

1. **자동 업데이트 모드 사용**: `vite-plugin-pwa`를 사용 중이라면 `autoUpdate` 활성화를 기본으로 합니다.
2. **리로드 프롬프트(Prompt) 제공**: 중요한 로직 수정 시, 캐시만 남아있으면 구문을 실행할 수 없습니다. 사용자 화면 아래에 '최신 버전이 있습니다. 새로고침 하세요' 스낵바(Toast) 로직을 추가하세요.

## 3. 에이전트 행동 지침
- "오프라인에서도 글 작성 되게 해줘"라는 요청을 받으면, `IndexedDB` 나 `dexie.js` 등 브라우저 기반 저장소를 사용하는 로직 초안을 제안하세요.
- 단순히 UI만 바꾸지 말고, 오프라인 시 Firebase Sync 지연(Timeout)을 우회/재시도(`useRetry`)하는 설계를 병행해야 합니다.
