/**
 * 인덱스 빌드 대기 게이트의 판정을 고정한다.
 *
 * 이 게이트는 **통과시키면 안 되는 상태를 통과시키는 것**이 실패 모드다. 그러면 Hosting이
 * 먼저 나가 새 번들 사용자의 화면이 비어 보이는데(2026-09-09 실제 사고, Sentry
 * JAVASCRIPT-REACT-6C), 증상은 배포 직후 현장에서만 드러난다. 그래서 "READY가 아닌 것을
 * 놓치지 않는가"와 "못 읽을 때 통과시키지 않는가"를 둘 다 못박는다.
 */
import { describe, it, expect } from 'vitest';
import { notReadyIndexes, collectionGroupsFrom } from '../wait-for-firestore-indexes';
import indexConfig from '../../firestore.indexes.json';

describe('notReadyIndexes', () => {
    it('전부 READY면 빈 목록을 돌려준다', () => {
        expect(notReadyIndexes({
            indexes: [
                { state: 'READY', fields: [{ fieldPath: 'organizationId' }] },
                { state: 'READY', fields: [{ fieldPath: 'date' }] },
            ],
        })).toEqual([]);
    });

    it('CREATING을 잡아낸다 — 필드까지 실어 어느 인덱스인지 보여 준다', () => {
        const pending = notReadyIndexes({
            indexes: [
                { state: 'READY', fields: [{ fieldPath: 'date' }] },
                { state: 'CREATING', fields: [{ fieldPath: 'organizationId' }, { fieldPath: 'date' }, { fieldPath: 'status' }] },
            ],
        });

        expect(pending).toHaveLength(1);
        expect(pending[0]).toContain('CREATING');
        expect(pending[0]).toContain('organizationId, date, status');
    });

    it('NEEDS_REPAIR도 미완료로 본다 — 저절로 낫지 않으므로 사람이 봐야 한다', () => {
        expect(notReadyIndexes({ indexes: [{ state: 'NEEDS_REPAIR', fields: [{ fieldPath: 'x' }] }] }))
            .toHaveLength(1);
    });

    it('인덱스가 없는 컬렉션 그룹은 정상으로 본다 (빈 배열·키 없음 모두)', () => {
        expect(notReadyIndexes({ indexes: [] })).toEqual([]);
        expect(notReadyIndexes({})).toEqual([]);
    });

    // ── 못 읽을 때는 통과시키지 않는다 ──
    it('오류 응답이면 throw 한다 (권한 문제를 조용히 통과시키지 않는다)', () => {
        expect(() => notReadyIndexes({ error: { status: 'PERMISSION_DENIED', message: 'nope' } }))
            .toThrow(/PERMISSION_DENIED/);
    });

    it('응답 모양이 다르면 throw 한다', () => {
        expect(() => notReadyIndexes(null)).toThrow();
        expect(() => notReadyIndexes('문자열')).toThrow();
        expect(() => notReadyIndexes({ indexes: '배열아님' })).toThrow(/배열이 아니다/);
    });

    it('state가 없는 항목도 미완료로 본다 — 모르면 기다린다', () => {
        expect(notReadyIndexes({ indexes: [{ fields: [{ fieldPath: 'x' }] }] })).toHaveLength(1);
    });
});

describe('collectionGroupsFrom', () => {
    it('중복 없이 정렬해 돌려준다', () => {
        expect(collectionGroupsFrom({
            indexes: [
                { collectionGroup: 'reservations' },
                { collectionGroup: 'driveLogs' },
                { collectionGroup: 'reservations' },
            ],
        })).toEqual(['driveLogs', 'reservations']);
    });

    it('실제 firestore.indexes.json에서 컬렉션 그룹을 뽑는다', () => {
        const groups = collectionGroupsFrom(indexConfig);

        expect(groups.length).toBeGreaterThan(0);
        // 이번 사고의 당사자 — 이 그룹이 빠지면 게이트가 그 인덱스를 보지 못한다.
        expect(groups).toContain('reservations');
    });

    it('읽을 수 없으면 throw 한다', () => {
        expect(() => collectionGroupsFrom({})).toThrow();
        expect(() => collectionGroupsFrom({ indexes: [] })).toThrow(/하나도 찾지 못했다/);
    });
});
