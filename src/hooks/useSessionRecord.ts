/**
 * useSessionRecord — 로그인 세션을 접속기록에 남긴다 (고시 제16조의 '접속지 정보')
 *
 * 변경 로그는 Firestore 트리거가 남기지만 트리거는 호출자의 IP를 볼 수 없다.
 * 그래서 IP·접속 환경은 콜러블(recordSession)이 서버에서 직접 읽어 기록한다.
 *
 * ## 브라우저 세션당 1회
 * 세션 식별자를 sessionStorage에 두고 그 값을 서버 문서 ID로 쓴다. 탭 복원·리렌더로
 * 여러 번 불려도 같은 문서를 덮어쓰므로 로그가 쌓이지 않는다. 탭을 닫으면
 * sessionStorage가 비워져 다음 접속은 새 기록이 된다 — 접속 단위와 잘 맞는다.
 *
 * ## 실패해도 화면을 막지 않는다
 * 접속기록은 사용자가 손쓸 수 있는 것이 아니고, 기록 실패로 로그인을 막으면 가용성
 * 손실이 훨씬 크다. 조용히 삼키고 Sentry로만 보고한다.
 */
import { useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebase';
import { useAuth } from './useAuth';
import { captureError } from '../lib/sentry';

const SESSION_KEY = 'auditSessionId';

/** 서버의 SESSION_ID_PATTERN(`[A-Za-z0-9_-]{8,64}`)을 만족하는 난수를 만든다. */
function newSessionId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 이 브라우저 세션의 식별자를 얻는다.
 * sessionStorage를 못 쓰는 환경(사파리 프라이빗 등)에서는 매번 새 값이 되어
 * 기록이 조금 늘 뿐 동작은 유지된다 — 기록을 포기하지 않는 쪽을 택한다.
 */
function getSessionId(): string {
    try {
        const existing = sessionStorage.getItem(SESSION_KEY);
        if (existing) return existing;
        const created = newSessionId();
        sessionStorage.setItem(SESSION_KEY, created);
        return created;
    } catch {
        return newSessionId();
    }
}

export default function useSessionRecord() {
    const { user, userDocState } = useAuth();
    /** StrictMode의 이중 마운트·리렌더로 중복 호출하지 않도록 uid별로 한 번만 보낸다. */
    const sentForUid = useRef<string | null>(null);

    useEffect(() => {
        // 사용자 문서가 확정되기 전에 부르면 서버가 기관을 못 찾아 __system__으로 남는다.
        if (!user || userDocState !== 'present') return;
        if (sentForUid.current === user.uid) return;
        sentForUid.current = user.uid;

        const record = httpsCallable(firebaseFunctions, 'recordSession');
        record({ sessionId: getSessionId() }).catch((err) => {
            captureError(err, { context: 'useSessionRecord', uid: user.uid });
        });
    }, [user, userDocState]);
}
