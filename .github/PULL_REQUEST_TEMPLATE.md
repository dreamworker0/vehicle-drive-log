## 변경 내용
<!-- 무엇을, 왜 바꿨는지 간단히 설명해 주세요. -->

## 관련 이슈
<!-- 예: Closes #42 -->

## 변경 유형
- [ ] 🐛 버그 수정 (fix)
- [ ] ✨ 새 기능 (feat)
- [ ] ♻️ 리팩토링 (refactor)
- [ ] 📝 문서 (docs)
- [ ] 🔧 기타 (chore)

## 체크리스트
- [ ] 커밋 메시지가 한국어 + Conventional Commits 규칙을 따름 (`feat:`, `fix:` 등)
- [ ] `npm run type-check` · `npm run lint` 통과
- [ ] `npm test` 통과 (관련 테스트 추가/갱신)
- [ ] Firestore 쿼리 추가 시 `organizationId` 필터 포함 + 복합 쿼리면 `firestore.indexes.json` 동기화
- [ ] 새 Cloud Function은 `functions/src/index.ts`에 export 등록
- [ ] 민감 정보(`.env`, API 키 등)를 포함하지 않음

## 확인 방법 / 스크린샷
<!-- 리뷰어가 검증할 수 있는 방법이나 UI 변경 스크린샷을 남겨 주세요. -->
