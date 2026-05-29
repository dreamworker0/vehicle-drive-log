## 2026-05-29T09:35:53Z
당신은 '차량 운행일지 PWA 서비스 개선 프로젝트'의 SEO 및 테스트 고도화 독립 검증단 소속의 전문 리뷰어(Reviewer 1)입니다.
현재 프로젝트 루트 디렉토리는 'd:\apps\차량운행일지' 이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\reviewer_seo_coverage_1' 입니다.

귀하의 임무는 Milestone 3(SEO 자동 생성 파이프라인 R3)과 Milestone 4(Vitest 테스트 커버리지 시각화 리포트 R4)의 구현 및 sw.ts PWA 서비스워커 경고 제거 구현에 대한 최종 코드 리뷰와 품질 검증을 수행하는 것입니다.

[상세 검증 지침]
1. **코드 정적 분석 및 리뷰**
   - `src/sw.ts` 파일의 `precacheAndRoute(self.__WB_MANIFEST);` 치환 수정 내역이 적절하고 빌드 경고를 완벽히 제거하는 구조인지 점검하십시오.
   - `scripts/generate-seo.ts` 스크립트 코드 품질을 점검하고, `package.json`의 `"postbuild"` 스크립트에 정합성 있게 연동되었는지 확인하십시오.
   - `vitest.config.js`의 `test.coverage.reporter` 내 `'html'` 포맷 추가 상태를 검증하십시오.

2. **빌드, 린트, 타입, 테스트 파이프라인 실측 검증**
   - 직접 `npx tsc --noEmit` (타입 체크), `npm run lint` (린트), `npm run build` (빌드), `npm run test:coverage` (테스트 커버리지 수집) 명령을 실행하십시오.
   - 모든 명령이 경고나 에러 없이 100% SUCCESS/PASS로 완료되는지 엄밀하게 증명하고 터미널의 실측 로그를 확보하십시오.

3. **생성물 물리적 정밀 검증**
   - 빌드 후 `dist/sitemap.xml` 및 `dist/robots.txt` 파일이 실제로 올바르게 생성되었는지 확인하십시오.
   - `sitemap.xml`의 유효한 XML 스키마(`xmlns`) 준수 여부 및 비로그인 핵심 경로(/, /apply, /terms, /privacy, /release-notes, /faq)에 대한 `<loc>`, `<lastmod>`, `<changefreq>`, `<priority>` 노드가 안정적으로 존재하며 도메인(`https://vehicle-drive-log.web.app`)과 일치하는지 분석하십시오.
   - `robots.txt`가 모든 크롤러 수집을 허용하고 Sitemap 절대 경로를 가리키는지 확인하십시오.
   - `npm run test:coverage` 실행 완료 후 `coverage/index.html`을 포함한 HTML 리포트 폴더가 실질적으로 생성 및 갱신되는지 실측 검증하십시오.

4. **행동 헌법 및 보안 가드 준수 진단**
   - 에이전트 행동 헌법(AGENTS.md)의 절대 금지 목록(D9, D10, D13, D17 등) 및 3대 보안 가드([GUARD-1] 시크릿 노출 차단, [GUARD-2] 배포 전 검증, [GUARD-3] 직접 fetch 금지)의 위반 유무를 면밀히 점검하십시오.

5. **결과 작성 및 완료 보고**
   - 모든 검증 작업을 완수한 후, 귀하의 전용 작업 폴더(`d:\apps\차량운행일지\.agents\reviewer_seo_coverage_1`)에 `handoff.md` 파일을 작성하십시오.
   - `handoff.md`에는 직접 관찰한 사실(Observation), 논리 추론(Logic Chain), 예외 및 한계(Caveats), 최종 판단(Conclusion - APPROVED 또는 REJECTED Verdict 명시), 검증 방법(Verification Method)을 한국어로 상세히 정리하여 기록하십시오.
   - 작성이 완료되면 오케스트레이터(Conv ID: 58b5b741-80c5-4e4d-9da9-48e6ea965491)에게 send_message 도구를 활용해 검증 완료와 보고서 작성을 통보하십시오. 모든 진행 과정 및 메시지는 한국어로만 작성해 주십시오.
