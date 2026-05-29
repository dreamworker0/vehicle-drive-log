# 커스텀 훅 추가 스킬 (로컬 사본)
- 원본: `d:\apps\차량운행일지\.agent\skills\add-hook\SKILL.md`

## 훅 생성 규칙
- 파일명: `use` + PascalCase + `.ts`
- 모든 Firestore 호출은 `lib/firestore` 경유.
- `organizationId` 필수 격리.
- `cleanup` 필수 (`useEffect` return에서 unsubscribe 등).
- `loading` 상태 및 에러 처리 (`console.error`).
