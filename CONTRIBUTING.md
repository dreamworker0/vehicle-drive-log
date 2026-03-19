# 🤝 기여 가이드 (CONTRIBUTING)

프로젝트에 기여해 주셔서 감사합니다! 아래 가이드를 따라 주세요.

---

## 개발 환경 세팅

```bash
# 1. Node.js 22 LTS 사용 (필수)
fnm use 22

# 2. 의존성 설치
npm install
cd functions && npm install && cd ..

# 3. 환경변수 설정
# .env 파일 생성 (README.md 참고)

# 4. 개발 서버 실행
npm run dev
```

---

## 코딩 컨벤션

### 파일 네이밍

| 대상 | 규칙 | 예시 |
|------|------|------|
| React 컴포넌트 | PascalCase + `.jsx` | `DriveLogForm.jsx` |
| 커스텀 훅 | camelCase + `use` 접두사 + `.js` | `useDriveLogForm.js` |
| 유틸/서비스 | camelCase + `.js` | `firestore.js`, `tmap.js` |
| 테스트 | 원본명 + `.test.jsx` / `.test.js` | `useToast.test.jsx` |
| Cloud Functions | camelCase + `.js` | `ocrDashboard.js` |

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

- **TailwindCSS v3** 유틸리티 클래스 사용
- 다크 모드: 모든 UI에 `dark:` 변형 적용 필수
- 커스텀 스타일: `src/index.css`에 정의된 디자인 토큰 사용

---

## Git 규칙

### 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 프로덕션 (자동 배포) |
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

1. **PR 생성 전** `npm run lint` 및 `npm test` 통과 확인
2. `main`에 직접 push 금지 → 반드시 PR 경유
3. CI (`ci.yml`)가 통과해야 머지 가능
4. PR 제목은 커밋 메시지 규칙과 동일
5. 변경 사항에 대한 간단한 설명 작성

---

## 테스트

### 단위 테스트 (Vitest)

```bash
npm test             # 전체 실행
npm run test:watch   # 감시 모드
```

- 테스트 파일 위치: `src/__tests__/`
- 네이밍: `*.test.js` 또는 `*.test.jsx`

### E2E 테스트 (Playwright)

```bash
npm run test:e2e
```

- 테스트 파일 위치: `e2e/`
- 개발 서버(`npm run dev`)가 실행 중이어야 함

---

## Cloud Functions 개발

- 파일 위치: `functions/` 디렉토리
- 새 함수 추가 시 `functions/index.js`에 등록
- 배포: `firebase deploy --only functions`
- 로그 확인: `firebase functions:log` 또는 `npm run health`

> 💡 새 Cloud Function 추가 시 `.agent/skills/add-cloud-function/SKILL.md` 참고
