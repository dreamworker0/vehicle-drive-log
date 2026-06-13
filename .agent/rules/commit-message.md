---
description: Git 커밋 메시지 작성 규칙. commitlint로 자동 강제되며, 모든 에이전트가 동일하게 따른다.
---

# 커밋 메시지 규칙

## 형식

```
<type>: <한국어 제목> (#이슈번호)

<한국어 본문 (선택)>
```

## 타입

| 타입 | 용도 | 예시 |
|------|------|------|
| `feat` | 새 기능 추가 | `feat: 하이패스 충전 내역 PDF 내보내기 추가` |
| `fix` | 버그 수정 | `fix: 예약 목록에서 organizationId 누락 수정` |
| `refactor` | 리팩토링 (동작 변경 없음) | `refactor: 직접 Firestore 호출을 헬퍼 함수로 분리` |
| `chore` | 설정, 문서, 의존성 등 | `chore: 배포 전 CHANGELOG 및 환경 변수 갱신` |
| `style` | 코드 포맷팅 (동작 변경 없음) | `style: ESLint 경고 수정 및 코드 정렬` |
| `test` | 테스트 추가/수정 | `test: 예약 취소 훅 단위 테스트 추가` |
| `perf` | 성능 개선 | `perf: Firestore 쿼리 최적화로 읽기 50% 감소` |
| `ci` | CI/CD 설정 변경 | `ci: GitHub Actions에 Node 22 강제 설정` |
| `docs` | 문서만 변경 | `docs: OPERATIONS.md 운영 체크리스트 갱신` |

## 규칙

1. **제목은 한국어**로 작성. 영어 기술 용어는 허용 (예: Firestore, Cloud Functions)
2. **제목은 50자 이내** 권장, 최대 72자
3. **제목 끝에 마침표(.) 금지**
4. **본문이 필요한 경우** 빈 줄로 구분 후 한국어로 작성
5. **commitlint**가 타입 및 형식을 자동 검증 ([commitlint.config.js](../../commitlint.config.js))
6. **배포 후 환경 변경**은 `chore:` 커밋으로 별도 분리

## 에이전트 전환 시

- 에이전트(Antigravity ↔ Claude Code) 전환 전에 반드시 현재 변경사항을 커밋한다.
- 미커밋 변경이 있는 상태에서 에이전트를 전환하지 않는다.
