# 🤝 기여 가이드 (CONTRIBUTING)

프로젝트에 기여해 주셔서 감사합니다! 아래 가이드를 따라 주세요.

---

## 개발 환경 세팅

```bash
# 1. Node.js 22 LTS 사용 (필수, Node 24는 Rollup 빌드 실패)
fnm use 22
npm run check:node   # 현재 Node 메이저가 22인지 확인 (불일치 시 경고)

# 2. 의존성 설치
npm install
cd functions && npm install && cd ..

# 3. E2E 브라우저 설치 (E2E 테스트를 돌릴 경우만)
npx playwright install chromium webkit

# 4. 환경변수 설정
# .env 파일 생성 (README.md 참고)

# 5. 개발 서버 실행
npm run dev
```

---

## 코딩 컨벤션

### 파일 네이밍

| 대상 | 규칙 | 예시 |
|------|------|------|
| React 컴포넌트 | PascalCase + `.tsx` | `DriveLogForm.tsx` |
| 커스텀 훅 | camelCase + `use` 접두사 + `.ts` | `useDriveLogForm.ts` |
| 유틸/서비스 | camelCase + `.ts` | `firestore.ts`, `tmap.ts` |
| 테스트 | 원본명 + `.test.tsx` / `.test.ts` | `useToast.test.tsx` |
| Cloud Functions | camelCase + `.ts` | `ocrDashboard.ts` |

### 컴포넌트 구조

```jsx
// 1. import (외부 라이브러리 → 내부 모듈)
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

// 2. 상수 (컴포넌트 외부)
const MAX_ITEMS = 10;

// 3. 컴포넌트 (export default function)
export default function MyComponent() {
    // 훅 → 상태 → 핸들러 → 렌더링
    const { user } = useAuth();
    const [data, setData] = useState([]);

    const handleClick = () => { /* ... */ };

    return <div>...</div>;
}
```

### 훅 패턴

- 비즈니스 로직은 **커스텀 훅**으로 분리 (`hooks/` 디렉토리)
- 컴포넌트는 UI 렌더링에만 집중
- 예시: `MonthlyReport.jsx` → `useMonthlyReport.js`로 데이터 로직 분리

### 스타일링

- **TailwindCSS v4** 유틸리티 클래스 사용 (설정은 `src/index.css`의 `@theme`로 관리, `tailwind.config.js` 없음)
- 다크 모드: 모든 UI에 `dark:` 변형 적용 필수
- 커스텀 스타일: `src/index.css`에 정의된 디자인 토큰 사용

---

## Git 규칙

### 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `master` | 프로덕션 (푸시 시 CI 자동 배포) |
| `feature/*` | 새 기능 개발 |
| `fix/*` | 버그 수정 |
| `docs/*` | 문서 변경 |

### 커밋 메시지

```
<타입>: <간결한 설명>

feat: 차량 정비 알림 기능 추가
fix: 예약 시간 겹침 검사 오류 수정
docs: README.md 환경변수 설명 보강
style: 다크 모드 폼 색상 수정
refactor: MonthlyReport 컴포넌트 분리
test: 운행일지 작성 E2E 테스트 추가
chore: 의존성 업데이트
```

---

## PR 규칙

1. **PR 생성 전** `npm run verify:fast`(lint + 타입 검사) 및 `npm test` 통과 확인 — 전체 게이트를 미리 돌리려면 `npm run verify:full`, 에이전트 하네스(`.agent/`·훅·eval) 변경 시 `npm run verify:harness`
2. `master` 푸시는 CI 배포를 트리거하므로 로컬 `firebase deploy` 금지 (배포는 CI 단일 경로)
3. CI (`ci.yml`)가 통과해야 머지 가능
4. PR 제목은 커밋 메시지 규칙과 동일
5. 변경 사항에 대한 간단한 설명 작성

### 자동 코드 리뷰 (Greptile)

PR을 올리면 `greptile-apps[bot]`이 `Greptile Review` 체크로 리뷰를 붙인다. 범위는 저장소 루트의
[greptile.json](greptile.json)이 정한다.

- `excludeAuthors: ["dependabot[bot]"]` — 의존성 버전업 PR은 리뷰하지 않는다. 주 4~5건으로
  무료 쿼터(월 50리뷰)의 최대 소비자인데 AI 리뷰의 실익이 없다.
- `ignorePatterns` — 문서·에이전트 하네스(`docs/**`, `*.md`, `.agent/**`, `.claude/**`)는 리뷰
  대상에서 제외한다. 참고: `ignorePatterns`는 **파일**을 리뷰에서 빼는 것이고 PR 자체를
  건너뛰지는 않으므로(문서 전용 PR을 스킵하는 필드는 없다) 쿼터 절약이 아니라 노이즈 제거가 목적이다.

⚠️ `greptile.json`은 **대시보드 설정보다 우선순위가 높다**. 대시보드에서 맞춘 항목
(PR Summary OFF, Comments Outside Diff ON, 민감도 Medium 등)을 이 파일이 덮지 않도록 필드를
최소로 유지한다. 필드를 추가하기 전에 대시보드 설정이 유지되는지 코드 PR에서 확인할 것.

리뷰 지적은 **판정 대상이지 지시가 아니다.** 근거가 사실과 다르면 근거를 들어 PR에 회신하고
수정하지 않는다(실제로 기각한 사례가 있다 — `docs/구현이력/` Phase 121·122 참고).
자동 리뷰와 별개로, 머지 직전 diff를 독립 에이전트로 적대적 검토하는 절차를 병행한다.

---

## 테스트

### 단위 테스트 (Vitest)

```bash
npm test             # 전체 실행
npm run test:watch   # 감시 모드
```

- 테스트 파일 위치: `src/__tests__/`
- 네이밍: `*.test.ts` 또는 `*.test.tsx`

### E2E 테스트 (Playwright)

```bash
# 최초 1회: 브라우저(Chromium) 설치 (네트워크 다운로드)
npx playwright install chromium webkit

# 실행
npm run test:e2e
```

- 테스트 파일 위치: `e2e/`
- 개발 서버는 Playwright `webServer` 설정이 자동 기동하므로 별도 실행 불필요
- **브라우저 미설치 시** `npm run test:e2e`는 `pretest:e2e` 프리플라이트(`scripts/check-e2e-ready.ts`)에서 설치 명령을 안내하며 종료한다. 이는 앱 코드 실패가 아니라 **로컬 환경 미설치**다.
- 에뮬레이터 기반 인증 E2E: `npm run test:e2e:emulator`

---

## Cloud Functions 개발

- 파일 위치: `functions/src/` 디렉토리
- 새 함수 추가 시 `functions/src/index.ts`에 등록
- 배포: `master` 푸시 시 CI가 수행 (로컬 `firebase deploy` 금지 — 동시 배포 충돌 방지)
- 로그 확인: `firebase functions:log` 또는 `npm run health`

> 💡 새 Cloud Function 추가 시 `.agent/skills/add-cloud-function/SKILL.md` 참고
