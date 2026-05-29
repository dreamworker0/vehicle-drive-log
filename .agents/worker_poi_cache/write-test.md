# 테스트 작성 가이드 (로컬 사본)
- 원본: `d:\apps\차량운행일지\.agent\skills\write-test\SKILL.md`

## 테스트 구조 및 핵심 요약
- 프론트엔드 단위 테스트 위치: `src/__tests__/hooks/useXxx.test.ts`
- Mock 안티패턴 방지:
  - 참조 불안정 → 무한 렌더 루프 방지를 위해 Mock 함수(vi.fn())는 훅 임포트 상단에서 변수로 정의 및 반환.
  - act() 래핑: 비동기 결과나 상태 변화는 `act`로 래핑.
- 테스트 이름은 한글로 작성, "~한다" 형식.
