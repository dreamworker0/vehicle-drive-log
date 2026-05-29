# Original User Request

## 2026-05-28T23:47:48Z

당신은 '차량 운행일지 PWA 서비스 개선 프로젝트'의 총괄 오케스트레이터(Project Orchestrator)입니다.

프로젝트 루트 디렉토리('d:\\apps\\차량운행일지')의 'ORIGINAL_REQUEST.md' 파일에 기록된 최신 요구사항(2026-05-29T08:47:20+09:00)을 확인하고, 4대 개선 과제(R1. Tmap POI 캐싱, R2. 구글 캘린더 온디맨드 동기화 보완, R3. SEO 자동화, R4. Vitest 테스트 커버리지 고도화)를 성공적으로 이행하기 위한 종합적인 구현 계획(plan.md)을 수립하십시오.

작업 시 다음 지침을 엄격히 준수하십시오:
1. 에이전트 행동 헌법('AGENTS.md')의 절대 금지 목록(Don'ts: D1~D19)과 보안 자율 점검 3대 가드([GUARD-1], [GUARD-2], [GUARD-3])를 반드시 준수하십시오. (특히 D9 Firestore 직접 호출 금지, D8 다크모드 페어링, D10 organizationId 누락 금지 등)
2. 필요할 때 각 과제에 특화된 하위 에이전트(Worker, Reviewer 등)를 기동 및 지휘하여 구현을 완수하고, 매 단계마다 'npx tsc --noEmit', 'npm run lint', 'npm run build' 등으로 빌드와 품질을 검증하십시오.
3. 작업 디렉토리는 '.agents/orchestrator/' 하위에 두며, 작업 계획은 'plan.md'에, 현재 진척 및 마일스톤 상태는 'progress.md'에 정기적으로 세밀하게 갱신하여 센티널(Sentinel)이 실시간 모니터링할 수 있도록 하십시오.
4. 모든 개발 및 테스트, 검증이 완벽히 끝나면 최종 Handoff 보고서(handoff.md)를 작성하고 센티널에게 완료 상태를 선언하여 주십시오.

모든 룰과 한국어 투명성 가이드를 지키며 최고의 완성도로 작업을 지휘해 주기 바랍니다.

## 2026-05-29T09:32:30+09:00 (2세대 총괄 오케스트레이터 인수)

당신은 '차량 운행일지 PWA 서비스 개선 프로젝트'를 인계받은 2세대 총괄 오케스트레이터(Project Orchestrator Gen 2)입니다.
현재 프로젝트 루트 디렉토리는 'd:\apps\차량운행일지'이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\orchestrator' 입니다.

[미션 및 상세 지침]
1. 전임 오케스트레이터가 인계한 'd:\apps\차량운행일지\.agents\orchestrator\handoff.md', 'BRIEFING.md', 'progress.md' 및 'd:\apps\차량운행일지\PROJECT.md'를 정밀하게 읽어 상황을 100% 복구하십시오.
2. 복구가 완료되면 immediately 'schedule' 도구를 구동해 liveness 하트비트 크론(*/10 * * * *)을 재개하여 귀하의 liveness를 센티널에게 알리십시오.
3. 귀하의 original parent는 'c9afdea9-20c4-4c76-bc97-aa9717582feb' 입니다. 모든 의사결정과 최종 완료/에스컬레이션 보고는 이 conversation ID(parent)로 send_message를 통해 복귀 보고를 올려주십시오.
4. 귀하의 즉각적인 액션 아이템은 **Milestone 3 (SEO 자동 생성 파이프라인 R3)**과 **Milestone 4 (Vitest 테스트 커버리지 시각화 리포트 R4)**의 계획을 수립하고, 필요시 하위 전문 에이전트(Worker, Reviewer, Auditor)를 스폰하여 구현을 완수하는 것입니다.
5. 에이전트 행동 헌법(AGENTS.md)의 절대 금지 조항(D9, D10, D13, D17 등) 및 3대 보안 가드를 철저하게 준수하고, 매 검증 단계마다 빌드/린트/타입/테스트를 완벽히 통과시키십시오.
6. 모든 룰과 한국어 투명성 가이드라인을 지켜 지혜롭게 개선을 마무리해 주시기 바랍니다.
