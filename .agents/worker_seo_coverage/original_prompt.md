## 2026-05-29T09:33:24Z

당신은 '차량 운행일지 PWA 서비스 개선 프로젝트'의 SEO 및 테스트 고도화 전문 구현 워커(Worker)입니다.
현재 프로젝트 루트 디렉토리는 'd:\apps\차량운행일지' 이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\worker_seo_coverage' 입니다.

귀하의 임무는 Milestone 3(SEO 자동 생성 파이프라인 R3)과 Milestone 4(Vitest 테스트 커버리지 시각화 리포트 R4)의 구현 요건을 해결하고, 기존 PWA 서비스워커 빌드 경고를 교정하는 것입니다.

[상세 구현 지침]

1. **PWA 서비스워커 sw.ts 주입 경로 경고 제거**
   - 파일: `src/sw.ts`
   - 분석: 36라인의 `precacheAndRoute(self.__WB_MANIFEST || []);` 코드로 인해 Vite PWA InjectManifest 플러그인이 `self.__WB_MANIFEST`를 원활하게 탐지 및 치환하지 못하는 빌드 경고가 발생합니다.
   - 조치: 해당 라인을 `precacheAndRoute(self.__WB_MANIFEST);` 로 변경하여 빌드 시 정적 프리캐싱 리스트가 안전하게 매핑되도록 하십시오.

2. **Milestone 3 - SEO 자동 생성 파이프라인 구축 (R3)**
   - 신규 스크립트 생성: `scripts/generate-seo.ts`를 작성하십시오.
   - 스크립트 요건:
     - Node.js `fs` 및 `path` 모듈을 활용하여 빌드 출력 경로(`dist/`)에 `sitemap.xml`과 `robots.txt`를 동적으로 배치 생성해야 합니다.
     - 타겟 웹서비스 도메인은 `https://vehicle-drive-log.web.app` 입니다.
     - Sitemap에 포함할 비로그인 공개 대상 핵심 주소는 다음과 같습니다:
       - `/` (메인/로그인 전 홈)
       - `/apply` (차량 예약 신청서 외 비로그인 공개 안내)
       - `/terms` (서비스 이용약관)
       - `/privacy` (개인정보처리방침)
       - `/release-notes` (업데이트 릴리즈 노트)
       - `/faq` (자주 묻는 질문)
     - `sitemap.xml`은 유효한 XML 스키마 규격(`xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`)을 엄수하고 각 주소별 `<lastmod>`(현재 일자 포맷), `<changefreq>`, `<priority>` 노드가 안정적으로 주입되도록 설계하십시오.
     - `robots.txt`는 모든 검색 크롤러(`User-agent: *`)의 수집 허용(`Allow: /`)을 명시하고, 맨 하단에 생성될 Sitemap 파일의 절대 도메인 경로(`Sitemap: https://vehicle-drive-log.web.app/sitemap.xml`)를 가리키도록 하십시오.
   - 빌드 연동:
     - `package.json`의 `"postbuild"` 스크립트(`tsx scripts/check-bundle-size.ts`) 뒤에 ` && tsx scripts/generate-seo.ts`를 이어붙여서, 빌드가 끝난 후 번들 예산 체크와 동시에 SEO 파일들이 `dist/` 하위에 자동 저장되도록 구성하십시오.

3. **Milestone 4 - Vitest 테스트 커버리지 시각화 리포트 체계 수립 (R4)**
   - 파일: `vitest.config.js`
   - 조치: `test.coverage.reporter` 배열에 기존 포맷(`'text'`, `'text-summary'`, `'json'`, `'lcov'`)을 보존하면서, 인터랙티브 가시화 리포트 생성을 위한 `'html'` 포맷을 추가하십시오.
   - 확인: `package.json`에 정의된 `"test:coverage": "vitest run --coverage"` 스크립트 실행 시 `coverage/` 폴더 하위에 HTML 보고서가 정상 수급되는지 점검할 환경을 준비하십시오.

4. **검증 가이드라인 및 절대 준수 룰**
   - **MANDATORY INTEGRITY WARNING**: DO NOT CHEAT. 모든 구현은 우회나 하드코딩 없이 비즈니스 로직과 자동 생성 런타임을 실질적으로 구동하는 정공법으로 설계되어야 합니다. 임시 목업 데이터나 가짜 검증 파일을 만드는 기만 행위는 포렌식 오디터의 검사에서 100% 감지되어 밀어내기 처리(REJECT)됩니다.
   - 에이전트 행동 헌법(AGENTS.md)의 D9 Firestore 직접 호출 차단, D10 테넌트 격리 등 모든 금지 조항과 3대 보안 가드([GUARD-1], [GUARD-2], [GUARD-3])를 위반하지 않도록 각별히 유의하십시오.
   - 구현 완료 직후 검증 파이프라인을 필수로 실행하여 `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:coverage` 명령어 결과 전원이 100% SUCCESS/PASS임을 실증하고, 그 결과를 핸드오프 파일에 투명하게 보고하십시오.

작업 완료 후 상세한 구현 명세와 검증 로그, 생성된 파일 경로들이 일목요연하게 정리된 `handoff.md` 파일을 귀하의 전용 작업 폴더에 남겨주시고 저에게 완료 보고를 해 주시기 바랍니다. 모든 진행은 한국어 투명성 가이드에 따라 완벽한 한국어로 보고해 주십시오.
