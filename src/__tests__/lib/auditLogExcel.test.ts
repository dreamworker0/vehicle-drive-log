/**
 * downloadAuditLogsExcel — 접속기록 엑셀 내보내기
 *
 * 고정하는 계약:
 *  (1) uid가 아니라 이름으로 적는다 (점검하는 사람이 읽는 파일이다)
 *  (2) 기록에 없는 것은 파일에도 없다 (바뀐 값·반출 내용은 애초에 저장하지 않는다)
 *  (3) 내보낸 사실이 접속기록에 남는다 — 이 파일은 IP를 담는 개인정보 반출이다
 *  (4) 화면과 같은 라벨을 쓴다 (한쪽만 갱신돼 어긋나면 점검 결과를 잘못 읽는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('xlsx', () => ({
    utils: {
        json_to_sheet: vi.fn().mockReturnValue({}),
        book_new: vi.fn().mockReturnValue({}),
        book_append_sheet: vi.fn(),
    },
    writeFile: vi.fn(),
}));

const mocks = vi.hoisted(() => ({ recordExport: vi.fn() }));
vi.mock('../../lib/audit/recordExport', () => ({ recordExport: mocks.recordExport }));

import * as XLSX from 'xlsx';
import { downloadAuditLogsExcel } from '../../lib/excelExport';
import type { AuditLog } from '../../types/auditLog';

const at = { toDate: () => new Date('2026-08-02T14:05:00') } as unknown as AuditLog['at'];

const log = (over: Partial<AuditLog>): AuditLog => ({
    id: 'l1',
    organizationId: 'org-1',
    action: 'update',
    targetType: 'driveLog',
    targetId: 'dl-1',
    actorUid: 'u1',
    actorSource: 'stamp',
    subjectUids: [],
    at,
    expiresAt: at,
    ...over,
});

const nameOf = (uid?: string | null) => (uid === 'u1' ? '김간사' : uid === 'u2' ? '이팀장' : '알 수 없음');

/** json_to_sheet에 넘어간 행 배열 */
const rows = () => vi.mocked(XLSX.utils.json_to_sheet).mock.calls[0][0] as Array<Record<string, unknown>>;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('downloadAuditLogsExcel', () => {
    it('빈 목록이면 파일을 만들지 않고 알린다', async () => {
        const onError = vi.fn();
        const result = await downloadAuditLogsExcel([], nameOf, '접속기록', { onError });

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith('다운로드할 데이터가 없습니다.');
        expect(XLSX.writeFile).not.toHaveBeenCalled();
        // 만들지 않은 파일의 반출을 기록하면 점검 결과가 부풀려진다
        expect(mocks.recordExport).not.toHaveBeenCalled();
    });

    it('접속 기록은 IP·접속 환경을 담고 행위자를 이름으로 쓴다', async () => {
        await downloadAuditLogsExcel([
            log({ action: 'login', targetType: 'session', actorSource: 'auth', ip: '203.0.113.7', userAgent: 'Chrome / Android' }),
        ], nameOf, '접속기록');

        expect(rows()[0]).toMatchObject({
            '일시': '2026.08.02 14:05',
            '구분': '로그인 접속',
            '행위자': '김간사',
            '행위자 확인': '확정',
            '접속지 IP': '203.0.113.7',
            '접속 환경': 'Chrome / Android',
        });
        expect(XLSX.writeFile).toHaveBeenCalledWith({}, '접속기록.xlsx');
    });

    it('변경 기록은 바뀐 항목 이름과 대상 직원을 한글로 적고, 값은 담지 않는다', async () => {
        await downloadAuditLogsExcel([
            log({ changedFields: ['destination', 'passengerNames'], subjectUids: ['u1', 'u2'] }),
        ], nameOf, '접속기록');

        const row = rows()[0];
        expect(row['구분']).toBe('운행일지 수정');
        expect(row['바뀐 항목']).toBe('목적지, 탑승자');
        expect(row['대상 직원']).toBe('김간사, 이팀장');
        // 값 컬럼 자체가 없어야 한다 — 있으면 파일이 개인정보 사본이 된다
        expect(Object.keys(row)).not.toContain('바뀐 값');
    });

    it('반출 기록은 대상·형식·건수를 적는다', async () => {
        await downloadAuditLogsExcel([
            log({ action: 'export', targetType: 'export', exportFormat: 'excel', exportDataset: 'driveLogs', recordCount: 1320 }),
        ], nameOf, '접속기록');

        expect(rows()[0]).toMatchObject({
            '구분': '내보내기 반출',
            '반출 대상': '운행일지 · 엑셀 파일',
            '반출 건수': 1320,
        });
    });

    it("행위자를 확정할 수 없으면 그 사실을 적는다", async () => {
        await downloadAuditLogsExcel([
            log({ action: 'delete', actorUid: null, actorSource: 'unknown' }),
        ], nameOf, '접속기록');

        expect(rows()[0]['행위자 확인']).toBe('행위자 미확인');
        expect(rows()[0]['행위자']).toBe('알 수 없음');
    });

    it('내보낸 사실을 접속기록에 남긴다 — 형식·대상·건수만', async () => {
        await downloadAuditLogsExcel([log({}), log({ id: 'l2' })], nameOf, '접속기록');
        expect(mocks.recordExport).toHaveBeenCalledWith('excel', 'auditLogs', 2);
    });
});
