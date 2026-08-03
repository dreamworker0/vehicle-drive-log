/**
 * useConsentGate — 현행 약관·처리방침 동의 상태 판정 및 재동의 기록
 *
 * 약관 제9조(개인정보 처리의 위탁)가 신설되기 전에 가입한 기관·직원에는 동의 기록이 없다.
 * 기관 관리자는 위탁 계약 당사자이므로 차단 모달로, 직원은 계정 개설·면책 근거이므로
 * 비차단 배너로 각각 동의를 받는다.
 *
 * 동의 기록은 Rules가 클라이언트 쓰기를 차단하므로 acceptCurrentTerms 콜러블만 기록한다.
 */
import { useState, useEffect, useCallback } from 'react';
import { callWithRetry, isTransientCallableError } from '../lib/callableRetry';
import { useAuth } from './useAuth';
import { getOrganization } from '../lib/firestore';
import { TERMS_VERSION, PRIVACY_VERSION } from '../lib/constants';
import { captureError } from '../lib/sentry';

export type ConsentRequirement = 'none' | 'admin' | 'employee';

export default function useConsentGate() {
    const { user, userData, userDocState } = useAuth();
    const [requirement, setRequirement] = useState<ConsentRequirement>('none');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const role = userData?.role;
    const organizationId = userData?.organizationId;
    const userTermsVersion = userData?.consent?.termsVersion;

    useEffect(() => {
        // 사용자 문서 로딩이 확정되기 전에는 판정하지 않는다(깜빡임·오판 방지).
        // 기관이 없는 상태(초대 코드 입력·승인 대기 중)는 가입 플로우가 동의를 받으므로 제외한다.
        // superAdmin은 organizationId가 없어 자연히 제외된다.
        if (userDocState !== 'present' || !user || !organizationId) {
            setRequirement('none');
            return;
        }

        let cancelled = false;

        const decide = async () => {
            const userNeedsTerms = userTermsVersion !== TERMS_VERSION;

            if (role !== 'admin') {
                if (!cancelled) setRequirement(userNeedsTerms ? 'employee' : 'none');
                return;
            }

            // 관리자는 기관의 위탁 계약 동의까지 확인해야 한다.
            try {
                const org = await getOrganization(organizationId);
                if (cancelled) return;
                const orgNeedsConsent =
                    org?.consent?.termsVersion !== TERMS_VERSION ||
                    org?.consent?.privacyVersion !== PRIVACY_VERSION;
                setRequirement(orgNeedsConsent || userNeedsTerms ? 'admin' : 'none');
            } catch (err) {
                // 기관 문서를 읽지 못하면 게이트를 띄우지 않는다.
                // 읽기 실패로 관리자를 차단하면 복구 수단 없이 앱을 못 쓰게 된다.
                captureError(err, { context: 'useConsentGate.getOrganization', organizationId });
                if (!cancelled) setRequirement('none');
            }
        };

        decide();
        return () => { cancelled = true; };
    }, [userDocState, user, role, organizationId, userTermsVersion]);

    /**
     * 재동의 기록. 성공 시 게이트를 닫는다.
     * userData의 onSnapshot이 갱신되면 판정도 자동으로 'none'이 되지만,
     * 갱신 지연 동안 모달이 남지 않도록 즉시 닫는다.
     *
     * 관리자에게는 차단 모달이라 실패가 곧 "앱을 못 씀"이다. 응답이 늦거나 끊기면
     * 사용자가 버튼을 다시 누르기 전에 한 번 더 부른다 — merge 쓰기라 반복해도 결과가 같다.
     * 다만 사용자가 스피너를 보고 있으므로 시도 횟수는 2회로 제한한다.
     */
    const accept = useCallback(async () => {
        setSubmitting(true);
        setError('');
        try {
            await callWithRetry('acceptCurrentTerms', {
                agreedTerms: true,
                termsVersion: TERMS_VERSION,
                // 관리자만 처리방침 동의를 함께 보낸다(위탁 계약 성립 요건).
                ...(requirement === 'admin'
                    ? { agreedPrivacy: true, privacyVersion: PRIVACY_VERSION }
                    : {}),
            }, { attempts: 2 });
            setRequirement('none');
            return true;
        } catch (err) {
            // 재시도까지 실패한 네트워크 문제도 보고한다 — 여기서의 실패는 관리자가
            // 모달에 갇혀 앱을 쓰지 못한다는 뜻이라, 조치(문의 대응)로 이어지는 신호다.
            captureError(err, {
                context: 'useConsentGate.accept',
                requirement,
                transient: isTransientCallableError(err),
            });
            setError('동의 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            return false;
        } finally {
            setSubmitting(false);
        }
    }, [requirement]);

    return { requirement, accept, submitting, error };
}
