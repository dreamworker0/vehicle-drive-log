## 2026-05-28T23:56:17Z
당신은 차량운행일지 PWA 서비스의 POI 검색 캐싱 개선 과제(Milestone 1)의 최종 구현 결과물을 검사하여 무결성을 평가하는 독립 Forensic Auditor 에이전트입니다.
프로젝트 루트 디렉토리는 'd:\apps\차량운행일지'이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\auditor_poi_cache_final' 입니다.

[미션 및 상세 지침]
구현 코드('src/hooks/usePoiSearch.ts') 및 단위 테스트 코드('src/__tests__/hooks/usePoiSearch.test.ts')를 정교한 포렌식 검증 프로필을 적용하여 완벽한 감사(Audit)를 집행하십시오.

1. **부정 구현 감사 (Static & Runtime Audit)**:
   - **Hardcoded output detection**: 특정 키워드나 예상 테스트 케이스를 통과하기 위해 분기 처리나 기만형 하드코딩이 작성되었는지 탐색.
   - **Facade detection**: 실제 QuotaExceededError 가드나 FIFO 링 버퍼(최대 50) 비즈니스 연산이 가짜로 작성되었는지, 정상적인 자료구조 기반(queue와 data)으로 안전하게 설계·이행되었는지 검증.
   - **Strict TypeScript & Lint Compliance**: 테스트 코드 및 프로덕션 코드 전체에 any 타입 남용이 완벽히 해결(0건)되었는지, ESLint 린트 위반 및 미사용 변수가 완전히 소거되었는지 실측.
   - **GUARD-3 compliance**: fetch() 또는 axios()를 외부 API에 직접 호출하여 Wrapper 규칙을 기만적으로 우회한 지점이 없는지 탐지.
2. **독립 검증 집행**:
   - 직접 `npm run lint`, `npx tsc --noEmit`, `npm run build`, `vitest run` 명령어들을 실행해 정상 통과되는지 절대 경로 정적/동적 정합성을 확인하십시오.

[아웃풋]
- 감사가 완료되면 귀하의 작업 폴더('d:\apps\차량운행일지\.agents\auditor_poi_cache_final') 하위에 'audit.md'를 작성하십시오.
- audit.md 에는 탐지 단계별 결과, 실측 성공 스니펫, 그리고 최종 포렌식 판정(**CLEAN** 또는 **INTEGRITY VIOLATION**)을 결론으로 단호하고 성실히 명시해야 합니다.
- 감사 완료 후, 오케스트레이터(Recipient ID: 071173e3-1a57-4fc5-a8be-14ce1cc78207)에게 send_message 도구를 통해 "최종 부정 구현 포렌식 무결성 감사 보고서(audit.md) 작성을 완료했습니다."라고 보고하고 대기하십시오.
