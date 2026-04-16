---
name: "add-analytics-tracking"
description: "GA4 로깅, Sentry 커스텀 Breadcrumbs 등 로깅/트래킹 코드를 주요 이벤트에 통합하기 위한 패턴 가이드"
---

# add-analytics-tracking 가이드

UX 데이터 보틀넥 분석이나 주요 비즈니스 플로우(UI 클릭, 회원 가입 프로세스 이탈 등)를 모니터링하기 위해 코드 내에 통일된 형태로 추적 코드를 심는 것을 목적으로 합니다.

## 1. 컴포넌트 이탈 / 주요 클릭 이벤트 추적
버튼이나 폼을 제출할 때마다 GA를 개별로 호출하지 않고, 내부 추적 유틸리티 함수나 커스텀 훅(`useTracking`)을 생성 후 이를 의존성으로 받아 호출하는 것을 권장합니다.

```typescript
// 권장 패턴: 버튼 컴포넌트 내 삽입
import * as Sentry from "@sentry/react";
import { logEvent } from "firebase/analytics";
import { analytics } from "@/lib/firebase"; // Firebase Analytics 초기화된 객체

export const logUserAction = (actionName: string, payload?: any) => {
  try {
    // 1. Google Analytics 전송
    logEvent(analytics, actionName, payload);
    
    // 2. 에러 큐(Breadcrumb)로 로깅 해두어 특정 에러 발생 시 직전 액션을 확인할 수 있게 함
    Sentry.addBreadcrumb({
      category: "user_action",
      message: actionName,
      data: payload,
      level: "info",
    });
  } catch (err) {
    console.warn("Tracking Error:", err);
  }
}
```

## 2. 활용 예시 (예: 차량 예약 버튼)
```tsx
import { logUserAction } from '@/lib/tracking';

function ReserveButton({ vehicleId }) {
  const handleClick = () => {
    logUserAction('click_reserve_vehicle', { vehicleId });
    // 본래 수행할 예약 로직 진행
  };

  return <button onClick={handleClick}>예약하기</button>;
}
```

## 3. 에이전트 행동 지침
- 새로운 페이지 플로우나 복잡한 Wizard 단계를 개발할 때, **"진행 단계가 변할 때마다(Analytics/Tracking) 로그를 추가할까요?"**라고 사용자에게 확인을 받으세요.
- Sentry Error Management 스킬/룰과 병행하여 사용하여, 트래킹 코드에서 에러가 발생하더라도 메인 비즈니스 로직(예약 등)이 터지지 않도록 예외 처리를 격리합니다.
