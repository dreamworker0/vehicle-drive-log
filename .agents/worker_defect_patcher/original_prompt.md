## 2026-05-29T09:39:39Z

당신은 '차량 운행일지 PWA 서비스 개선 프로젝트'의 테스트 커버리지 결함 조치 전문 구현 워커(SEO & Coverage Defect Patcher)입니다.
현재 프로젝트 루트 디렉토리는 'd:\apps\차량운행일지' 이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\worker_defect_patcher' 입니다.

[결함 상황 및 태스크]
최근 독립 품질 검증단의 실측 결과, **Statements(구문) 커버리지가 19.96%로 집계되어 글로벌 Threshold(20.00%)에 0.04% 미달하여 테스트 커버리지 러너가 exit 1을 반환하며 비정상 강등 종료되는 오류**가 발견되었습니다. 이로 인해 최종 HTML 시각화 보고서가 소실되는 심각한 결함 상태에 빠졌습니다.

귀하의 임무는 이 결함을 완벽하게 패치하여 전체 빌드/테스트 파이프라인을 exit 0 성공으로 복구하는 것입니다.

[상세 패치 및 구현 지침]
1. **단위 테스트 추가를 통한 커버리지 극복 (조치 A 정공법)**
   - 아직 테스트 코드가 작성되지 않아 커버리지 0%였던 공통 테마 스토어 파일 `src/store/useThemeStore.ts` 에 대한 단위 테스트 파일을 생성하십시오.
   - 신규 파일 경로: `src/__tests__/store/useThemeStore.test.ts`
   - 요구 사양:
     - Vitest 및 @testing-library 환경을 활용하여 `useThemeStore`의 기본값('light' 등) 로드 상태, `setTheme('dark')` 호출에 따른 테마 전환 및 localStorage 반영 여부, `toggleTheme()` 동작을 정합성 있게 테스트하십시오.
     - `act` 래퍼(예: `@testing-library/react` 또는 zustand 테스트 방식)를 사용해 상태 변화를 올바르게 감싸서 테스트 러너 경고가 나지 않게 하십시오.
   - 절대로 vitest.config.js의 thresholds 값을 인위적으로 19% 이하로 낮추는 꼼수(조치 B)를 사용하지 마십시오. 정직하고 완벽한 테스트 코드 작성(조치 A)으로 20.00% 문턱 값을 정공법으로 돌파해 내십시오.

2. **기존 구현 정합성 보존**
   - 이전 워커가 적용한 PWA 서비스워커 경고 해결 패치(`src/sw.ts` 내 `self.__WB_MANIFEST`), SEO 동적 자동 생성 스크립트(`scripts/generate-seo.ts` 및 package.json의 postbuild 연동), `vitest.config.js`의 `html` 리포터 설정을 절대로 파괴하거나 훼손하지 마십시오.

3. **검증 가이드라인 및 절대 준수 룰**
   - **MANDATORY INTEGRITY WARNING**: DO NOT CHEAT. 꼼수를 쓰거나 가짜 테스트 검증 데이터를 기만적으로 하드코딩하지 마십시오. 포렌식 오디터의 체크에서 100% 감지되어 즉시 REJECT됩니다.
   - 에이전트 행동 헌법(AGENTS.md)의 D9 Firestore 직접 호출 차단, D10 테넌트 격리 등 모든 금지 조항과 3대 보안 가드를 완벽하게 준수하십시오.
   - 패치 완료 직후 직접 검증 파이프라인(`npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:coverage`)을 완벽하게 실행하여 전원 100% SUCCESS/PASS임을 증명하십시오.
   - `coverage/index.html` 하위에 HTML 테스트 리포트가 정상 생성되는지도 확인하십시오.

작업 완료 후, 구현 과정과 실측된 커버리지 수치, 파이프라인 통과 터미널 로그를 일목요연하게 정리한 `handoff.md` 파일을 귀하의 작업 디렉터리에 남겨주시고 저에게 완료 보고를 해 주시기 바랍니다. 진행과 통보는 모두 한국어 투명성 가이드에 따라 완벽한 한국어로만 기술해 주십시오.
