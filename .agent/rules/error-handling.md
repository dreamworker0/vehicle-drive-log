# 글로벌 룰: 에러 핸들링 및 로깅 의무화 (Error Handling & Logging Guidelines)

이 규칙은 `차량운행일지` 프로젝트에서 코드를 작성, 수정 또는 에이전트를 통해 기능을 생성할 때 **반드시 준수**해야 하는 글로벌 행동 규칙입니다.

## 1. 목적
조용히 실패하는 예외(Silent Failure)를 방지하고, 에러 모니터링 시스템(Sentry) 및 디버깅 로그를 일관되게 남기기 위함입니다. 차량운행일지는 다양한 운영체제와 인앱 브라우저에서 실행되므로 예외 관리가 필수적입니다.

## 2. 세부 원칙
- **선행 룰 확인**: 비동기 및 주요 로직을 짤 때 무조건 이 룰을 기준으로 체크.
- **빈 catch 블록 절대 금지**: `try-catch` 구문을 작성할 때 `catch` 블록을 비워두거나 단순히 `console.error`만 남기지 마세요.
- **Sentry 연동 필수**: 프론트엔드 및 백엔드 로직에서 의미 있는 비즈니스 에러가 발생할 소지가 있다면, 항상 Sentry(또는 시스템에 설정된 중앙 집중형 로거)의 `captureException`을 활용해 기록하세요.
- **컨텍스트 포함**: 에러를 로깅할 때 단순 메세지만 보내지 말고, 영향을 받은 사용자 ID, 발생 위치, 관련 데이터(페이로드) 등의 컨텍스트(Context/Breadcrumbs)를 함께 넘겨야 합니다.

## 3. 적용 예시 (권장 패턴)
```typescript
import * as Sentry from '@sentry/react'; // 프론트엔드 예시

try {
  await someAsyncFunction(payload);
} catch (error) {
  // [MUST] 1. 단순히 삼키지 않는다. 
  // [MUST] 2. 상태 컨텍스트와 함께 Sentry 기록
  Sentry.withScope((scope) => {
    scope.setExtra('payload', payload);
    Sentry.captureException(error);
  });
  
  // [MUST] 3. 사용자에게 안전한 피드백 메세지 제공 (Toast 등)
  showToast("데이터 처리 중 문제가 발생했습니다.");
  throw error; // 필요 시 상위로 전파
}
```

## 4. 에이전트 체크리스트
에이전트는 사용자가 코드를 수정해달라고 요청할 때 위 사항이 누락되어 있다면 먼저 **"try-catch 및 Sentry 로깅 처리를 포함해 작성해드릴까요?"** 라고 묻거나 코드를 자동으로 보강하여 제시해야 합니다.
