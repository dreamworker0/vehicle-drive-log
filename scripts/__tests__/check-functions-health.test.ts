// Cloud Functions 상태 리포트의 로그 분류 단위 테스트.
//
// 이 게이트가 고쳐야 했던 문제는 "에러를 못 잡는 것"이 아니라 **정상 상황을 경보로 올리는
// 것**이었다. 2026-09-04 배포 직후 19건의 ERROR 중 13건이 배포 중 쿼터 재시도(플랫폼 감사
// 로그)였는데 전부 함수 에러로 집계돼 "🚨 점검이 필요합니다"가 떴다. 두 번 다 실제로는
// 정상이었다. 이렇게 늑대가 계속 울면 진짜 장애가 났을 때 그 경보가 묻힌다.
//
// 픽스처는 그날 실제 로그에서 가져왔다.
import { describe, it, expect } from 'vitest';
import { summarizeLogs, classifyError } from '../check-functions-health';

/** 실제 배포 중 남은 쿼터 초과 감사 로그 (길어서 핵심만 남김) */
const DEPLOY_QUOTA = '2026-09-04T21:51:05.558608330Z E auditUserUpdated: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","status":{"code":8,"message":"Could not update Cloud Run service projects/vehicle-drive-log/locations/asia-northeast3/services/audituserupdated. Quota exceeded for quota metric \'Write requests\' and limit \'Write requests per minute per region\'"},"methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction"}';

/** 배포 실패인데 쿼터가 아닌 경우 — 사람이 봐야 한다 */
const DEPLOY_OTHER = '2026-09-04T21:51:05.000000Z E slackEvents: {"@type":"type.googleapis.com/google.cloud.audit.AuditLog","status":{"code":7,"message":"Permission denied on service account"},"methodName":"google.cloud.functions.v2.FunctionService.UpdateFunction"}';

/** 본문 없는 요청 로그 — 심각도가 HTTP 상태에서 온다 (tmapproxy가 502로 응답한 경우) */
const REQUEST_LOG = '2026-09-04T14:42:28.398488Z E tmapproxy: ';

/** 함수가 직접 남긴 에러 */
const APP_ERROR = '2026-09-04T14:42:29.000000Z E tmapproxy: {"message":"T맵 API JSON 파싱 실패 (poi)","function":"tmapProxy"}';

const WARNING = '2026-09-04T14:42:29.951173Z W tmapproxy: {"message":"T맵 API 빈 응답 (poi)","status":204}';

/** Remote Config 폴백 — DEBUG다. 본문에 "error"가 들어 있어도 에러가 아니다 */
const DEBUG_WITH_ERROR_WORD = '2026-09-04T14:42:29.093262Z D tmapproxy: {"message":"Remote Config fetch failed, using defaults","error":"[NOT_FOUND]: Template not found"}';

describe('classifyError — ERROR 한 줄의 출처', () => {
    it('플랫폼 감사 로그는 deploy', () => {
        expect(classifyError(' {"@type":"type.googleapis.com/google.cloud.audit.AuditLog"}')).toBe('deploy');
    });

    it('본문이 비면 request (HTTP 상태에서 유래한 요청 로그)', () => {
        expect(classifyError(' ')).toBe('request');
        expect(classifyError('')).toBe('request');
    });

    it('함수가 남긴 본문이 있으면 app', () => {
        expect(classifyError(' {"message":"뭔가 터짐"}')).toBe('app');
    });
});

describe('summarizeLogs — 배포 이벤트를 판정에서 뺀다', () => {
    it('배포 쿼터 재시도만 있으면 런타임 에러는 0이다 (늑대를 울리지 않는다)', () => {
        const r = summarizeLogs([DEPLOY_QUOTA, DEPLOY_QUOTA, DEPLOY_OTHER].join('\n'));
        expect(r.runtimeErrors).toBe(0);
        expect(r.deployEvents).toBe(3);
        expect(r.deployQuotaEvents).toBe(2);
        expect(r.errorFunctions).toEqual({});
    });

    it('배포 이벤트를 숨기지는 않는다 — 대상 함수까지 남긴다', () => {
        const r = summarizeLogs([DEPLOY_QUOTA, DEPLOY_OTHER].join('\n'));
        expect(r.deployFunctions).toEqual(['auditUserUpdated', 'slackEvents']);
    });

    it('쿼터가 아닌 배포 실패는 따로 셀 수 있다 (deployEvents - deployQuotaEvents)', () => {
        const r = summarizeLogs([DEPLOY_QUOTA, DEPLOY_OTHER].join('\n'));
        expect(r.deployEvents - r.deployQuotaEvents).toBe(1);
    });
});

describe('summarizeLogs — 런타임 에러는 종류를 나눠 센다', () => {
    it('요청 로그와 함수 로그를 구분한다', () => {
        const r = summarizeLogs([REQUEST_LOG, REQUEST_LOG, APP_ERROR].join('\n'));
        expect(r.requestErrors).toBe(2);
        expect(r.appErrors).toBe(1);
        expect(r.runtimeErrors).toBe(3);
        expect(r.errorFunctions).toEqual({ tmapproxy: { app: 1, request: 2 } });
    });

    it('경고는 에러로 세지 않는다', () => {
        const r = summarizeLogs([WARNING, WARNING].join('\n'));
        expect(r.warnings).toBe(2);
        expect(r.runtimeErrors).toBe(0);
    });

    it('본문에 "error"가 있어도 DEBUG는 에러가 아니다', () => {
        const r = summarizeLogs(DEBUG_WITH_ERROR_WORD);
        expect(r.runtimeErrors).toBe(0);
        expect(r.warnings).toBe(0);
        expect(r.parsed).toBe(1);
    });
});

describe('summarizeLogs — 판정 범위', () => {
    it('시간 구간과 등장 함수를 정렬해 보고한다', () => {
        const r = summarizeLogs([APP_ERROR, DEPLOY_QUOTA, REQUEST_LOG].join('\n'));
        expect(r.firstTimestamp).toBe('2026-09-04T14:42:28.398488Z');
        expect(r.lastTimestamp).toBe('2026-09-04T21:51:05.558608330Z');
        expect(r.seenFunctions).toEqual(['auditUserUpdated', 'tmapproxy']);
    });

    it('형식에 맞지 않는 줄은 건너뛴다 (여러 줄로 쪼개진 JSON 등)', () => {
        const r = summarizeLogs(['  "detail": "continuation"', '}', APP_ERROR].join('\n'));
        expect(r.parsed).toBe(1);
        expect(r.appErrors).toBe(1);
    });

    it('빈 입력에서도 터지지 않는다', () => {
        const r = summarizeLogs('');
        expect(r.parsed).toBe(0);
        expect(r.runtimeErrors).toBe(0);
        expect(r.firstTimestamp).toBeNull();
    });

    // Windows의 firebase CLI는 CRLF로 내보낸다. 줄 끝 \r이 남으면 정규식의 `$` 앵커가 걸려
    // 한 줄도 파싱되지 않고, 그 상태로 "에러 없음"이 출력된다 — 감시기가 fail-open으로 도는
    // 최악의 모양이다. 실제로 이 리팩터링 중에 한 번 그렇게 만들었다.
    it('CRLF 출력에서도 파싱된다 (조용한 fail-open 차단)', () => {
        const r = summarizeLogs([APP_ERROR, REQUEST_LOG, WARNING].join('\r\n') + '\r\n');
        expect(r.parsed).toBe(3);
        expect(r.appErrors).toBe(1);
        expect(r.requestErrors).toBe(1);
        expect(r.warnings).toBe(1);
    });

    it('CRLF 요청 로그의 빈 본문을 app으로 오분류하지 않는다', () => {
        expect(summarizeLogs(REQUEST_LOG + '\r\n').requestErrors).toBe(1);
        expect(summarizeLogs(REQUEST_LOG + '\r\n').appErrors).toBe(0);
    });
});

// 그날의 실제 구성을 그대로 재현한다 — 이 조합에서 예전 스크립트는 "🚨 에러 7회"를 띄웠다.
describe('summarizeLogs — 2026-09-04 배포 직후 재현', () => {
    it('배포 쿼터 7건 + 요청 로그 0건이면 판정은 통과여야 한다', () => {
        const lines = Array.from({ length: 7 }, () => DEPLOY_QUOTA);
        const r = summarizeLogs(lines.join('\n'));
        expect(r.deployEvents).toBe(7);
        expect(r.deployQuotaEvents).toBe(7);
        expect(r.runtimeErrors).toBe(0); // 예전에는 7이었고 "점검이 필요합니다"가 떴다
    });
});
