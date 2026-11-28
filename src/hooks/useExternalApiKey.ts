/**
 * useExternalApiKey — 설정 화면의 외부 연동(API) 키 상태·발급·폐기 로직
 *
 * 키 컬렉션(externalApiKeys)은 Rules로 클라이언트 접근이 막혀 있어 모든 조회·조작은
 * `manageExternalApiKey` 콜러블을 거친다. 원래 키 값은 **발급 응답에서 한 번만** 오고,
 * 이 훅도 화면을 떠나면 잊는다(저장소·전역 상태에 넣지 않는다).
 *
 * 발급·폐기는 재시도(callWithRetry)를 걸지 않는다 — 발급은 부를 때마다 새 키가 나오는
 * 비멱등 호출이라, 응답을 놓친 채 다시 부르면 첫 키는 화면에 나오지도 않고 지워진다.
 */
import { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebase';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';

export interface ExternalApiKeyStatus {
    hasKey: boolean;
    /** 키 끝 4자리 */
    hint?: string | null;
    /** ISO 문자열 */
    createdAt?: string | null;
    /** ISO 문자열. 한 번도 안 쓰였으면 null */
    lastUsedAt?: string | null;
}

interface ManageResponse {
    status: ExternalApiKeyStatus;
    apiKey?: string;
}

type Action = 'status' | 'issue' | 'revoke';

async function callManage(action: Action): Promise<ManageResponse> {
    const call = httpsCallable<{ action: Action }, ManageResponse>(firebaseFunctions, 'manageExternalApiKey');
    const res = await call({ action });
    return res.data;
}

function errorMessage(err: unknown, fallback: string): string {
    // 서버가 의도적으로 던진 안내(예: "기능 사용에서 먼저 켜 주세요")는 그대로 보여 준다
    const e = err as { code?: unknown; message?: unknown };
    const code = typeof e?.code === 'string' ? e.code : '';
    if (code.endsWith('failed-precondition') && typeof e.message === 'string') return e.message;
    if (code.endsWith('resource-exhausted')) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    return fallback;
}

export function useExternalApiKey() {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [status, setStatus] = useState<ExternalApiKeyStatus | null>(null); // null = 불러오는 중
    const [loadFailed, setLoadFailed] = useState(false);
    /** 방금 발급한 원래 키 — 이 화면에서만 한 번 보여 준다 */
    const [issuedKey, setIssuedKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoadFailed(false);
        try {
            const data = await callManage('status');
            setStatus(data.status);
        } catch (err) {
            console.warn('[useExternalApiKey] 상태 조회 실패:', err);
            setLoadFailed(true);
            setStatus({ hasKey: false });
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const issue = useCallback(async () => {
        if (status?.hasKey) {
            const ok = await confirm({
                message: '새 키를 발급할까요?\n지금 쓰는 키는 바로 폐기되어, 그 키를 넣은 프로그램은 새 키로 바꿀 때까지 조회가 안 됩니다.',
                confirmColor: 'warning',
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            const data = await callManage('issue');
            setStatus(data.status);
            setIssuedKey(data.apiKey ?? null);
            showToast('API 키를 발급했습니다. 지금 복사해 두세요.', 'success');
        } catch (err) {
            console.warn('[useExternalApiKey] 발급 실패:', err);
            showToast(errorMessage(err, 'API 키를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.'), 'error');
        } finally {
            setBusy(false);
        }
    }, [status?.hasKey, confirm, showToast]);

    const revoke = useCallback(async () => {
        const ok = await confirm({
            message: 'API 키를 폐기할까요?\n이 키를 넣은 프로그램은 바로 조회할 수 없게 됩니다.',
            confirmColor: 'danger',
        });
        if (!ok) return;
        setBusy(true);
        try {
            const data = await callManage('revoke');
            setStatus(data.status);
            setIssuedKey(null);
            showToast('API 키를 폐기했습니다.', 'success');
        } catch (err) {
            console.warn('[useExternalApiKey] 폐기 실패:', err);
            showToast(errorMessage(err, 'API 키를 폐기하지 못했습니다. 잠시 후 다시 시도해 주세요.'), 'error');
        } finally {
            setBusy(false);
        }
    }, [confirm, showToast]);

    /** 발급 직후 보여 준 키를 화면에서 지운다(확인했어요) */
    const dismissIssuedKey = useCallback(() => setIssuedKey(null), []);

    return { status, loadFailed, issuedKey, busy, issue, revoke, dismissIssuedKey, reload: load };
}
