/**
 * actorStamp — 행위자 스탬프 (접속기록의 '계정' 항목, 고시 제16조)
 *
 * 값 자체의 신뢰는 Rules(`actorStampValid()`)가 담보하므로
 * 여기서는 "없는 값을 지어내지 않는다"는 계약만 고정한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로 상위 변수를 참조할 수 없다.
// vi.hoisted로 먼저 만들어 두고 팩토리와 테스트가 같은 객체를 공유한다.
const mockAuth = vi.hoisted(() => ({ currentUser: null as { uid: string } | null }));
vi.mock('../../lib/firebase', () => ({ auth: mockAuth, db: {} }));

import { actorStamp } from '../../lib/firestore/actorStamp';

describe('actorStamp', () => {
    beforeEach(() => {
        mockAuth.currentUser = null;
    });

    it('로그인 상태면 현재 사용자 uid를 담는다', () => {
        mockAuth.currentUser = { uid: 'user-1' };
        expect(actorStamp()).toEqual({ lastEditedByUid: 'user-1' });
    });

    it('비로그인 상태면 빈 객체를 반환한다 — 행위자를 지어내지 않는다', () => {
        expect(actorStamp()).toEqual({});
    });

    it('스프레드로 합쳐도 다른 필드를 덮어쓰지 않는다', () => {
        mockAuth.currentUser = { uid: 'user-2' };
        expect({ destination: '용산', ...actorStamp() }).toEqual({
            destination: '용산',
            lastEditedByUid: 'user-2',
        });
    });

    it('비로그인 상태의 스프레드는 필드를 undefined로 만들지 않는다', () => {
        // { lastEditedByUid: undefined }를 반환하면 Firestore 쓰기에 undefined가 섞여
        // sanitizeUndefined를 거치지 않는 경로에서 오류가 난다.
        const payload = { destination: '용산', ...actorStamp() };
        expect('lastEditedByUid' in payload).toBe(false);
    });
});
