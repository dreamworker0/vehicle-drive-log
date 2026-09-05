import { describe, it, expect } from 'vitest';
import { deleteField, serverTimestamp } from 'firebase/firestore';
import { SERVER_TIMESTAMP_MARKER, DELETE_FIELD_MARKER } from '@/lib/offline/syncQueue';

/**
 * 센티널 판별의 **실물 계약**을 고정한다.
 *
 * syncQueue.test.ts는 firebase/firestore를 통째로 목으로 바꾸고, 그 목이 구현이 찾는 모양
 * (`_methodName`)을 스스로 만들어 넣는다. 그래서 그 테스트는 통과해도 실제 SDK 센티널에 대해서는
 * 아무것도 증명하지 못한다 — 번들러가 속성 이름을 뭉개거나 SDK가 내부 표현을 바꾸면 조용히
 * serverTimestamp로 떨어져, **날짜 문자열 자리에 타임스탬프가 박히는** 사고가 그대로 되살아난다.
 *
 * 여기서는 목 없이 진짜 센티널을 만들어 그 전제를 직접 확인한다.
 */
describe('오프라인 큐 센티널 판별 — 실물 SDK 계약', () => {
    it('실제 deleteField()와 serverTimestamp()는 서로 구분 가능한 _methodName을 갖는다', () => {
        const del = deleteField() as unknown as { _methodName?: string };
        const ts = serverTimestamp() as unknown as { _methodName?: string };

        expect(del._methodName).toBe('deleteField');
        expect(ts._methodName).toBe('serverTimestamp');
        expect(del._methodName).not.toBe(ts._methodName);
    });

    it('두 마커는 서로 다르다 — 같으면 삭제가 타임스탬프로 되살아난다', () => {
        expect(DELETE_FIELD_MARKER).not.toBe(SERVER_TIMESTAMP_MARKER);
    });
});
