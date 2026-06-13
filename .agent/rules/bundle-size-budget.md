---
description: 프론트엔드 번들 크기 임계치와 새 라이브러리 추가 시 판단 기준.
---

# 번들 크기 예산 (Bundle Size Budget)

## 1. 자동 검증

`npm run build`의 `postbuild` 훅이 `scripts/check-bundle-size.ts`를 실행하여 번들 크기를 자동 체크한다.
임계치 초과 시 빌드가 실패한다.

## 2. 새 라이브러리 추가 기준

```
기존 라이브러리로 가능한가?
   ├─ 예 → 기존 것 사용 (agents.md D15)
   └─ 아니오 → gzip 압축 후 크기는?
        ├─ < 10KB → 에이전트가 자동 추가 가능
        ├─ 10~50KB → 사용자에게 확인 요청 (대안 제시 필수)
        └─ > 50KB → 사용자에게 반드시 확인 + 번들 분석 결과 첨부
```

## 3. 번들 분석 방법

```bash
# 번들 크기 확인
npm run build

# 상세 번들 분석 (필요 시)
npx vite-bundle-analyzer
```

## 4. 주의 사항

- Tree-shaking이 안 되는 라이브러리(moment.js 등)는 특히 주의
- 동적 import(`React.lazy`)를 활용하여 초기 로딩 번들에서 제외 가능한지 먼저 검토
- `src/lib/lazyWithRetry.ts` 유틸을 사용하여 lazy loading 실패 시 자동 재시도
