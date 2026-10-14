/**
 * ConsentGate — 현행 약관·처리방침 재동의 UI
 *
 * 기관 관리자: 차단 모달. 위탁 계약(약관 제9조)의 당사자가 기관이고 그 의사표시를
 * 관리자가 하므로, 동의 없이 기관 데이터를 계속 처리할 근거가 없다.
 * 직원: 비차단 배너. 계정 개설·면책 근거이므로 업무를 막을 사유는 아니다.
 *
 * 두 경로 모두 개인정보 동의를 직원에게 요구하지 않는다(useConsentGate 주석 참고).
 */
import useConsentGate from '../../hooks/useConsentGate';
import { PRIVACY_VERSION, formatLegalVersion } from '../../lib/constants';

/** 약관·처리방침 링크 — 모달에 갇히지 않도록 새 탭으로 연다. */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 dark:text-primary-400 underline underline-offset-2 font-medium hover:text-primary-700 dark:hover:text-primary-300"
        >
            {children}
        </a>
    );
}

export default function ConsentGate() {
    const { requirement, accept, submitting, error } = useConsentGate();

    if (requirement === 'none') return null;

    if (requirement === 'employee') {
        return (
            <div
                role="region"
                aria-label="약관 동의 안내"
                className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pointer-events-none"
            >
                <div className="mx-auto max-w-2xl pointer-events-auto rounded-2xl border border-primary-200 bg-white shadow-soft p-4 dark:border-primary-800 dark:bg-surface-800">
                    <p className="text-sm text-surface-700 dark:text-surface-300 mb-1">
                        <LegalLink href="/terms">이용약관</LegalLink>이 개정되었습니다.
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mb-3 leading-relaxed">
                        개인정보의 수집·이용 안내는 소속 기관에서 받으실 수 있습니다.
                    </p>
                    {error && <p className="text-xs text-red-500 dark:text-red-400 mb-2">{error}</p>}
                    <button
                        type="button"
                        onClick={accept}
                        disabled={submitting}
                        className="btn-primary w-full min-h-[48px] text-sm"
                    >
                        {submitting ? '처리 중...' : '확인했습니다'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-gate-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        >
            <div className="w-full max-w-md rounded-2xl bg-white shadow-soft p-6 dark:bg-surface-800">
                <h2
                    id="consent-gate-title"
                    className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-3"
                >
                    개정 약관 동의가 필요합니다
                </h2>
                <div className="text-sm text-surface-600 dark:text-surface-400 space-y-2 mb-4 leading-relaxed">
                    {/* 개정마다 이 창이 다시 뜬다 — 특정 개정의 내용을 적으면 다음 개정 때 틀린 안내가 된다
                        (8월 위탁 조항 신설 문구가 10월 개정 때도 그대로 떴다). 바뀐 내용은 문서의 개정 이력이 정본이다. */}
                    <p>
                        <LegalLink href="/terms">이용약관</LegalLink>과 <LegalLink href="/privacy">개인정보 처리방침</LegalLink>이
                        개정되어 <strong>{formatLegalVersion(PRIVACY_VERSION)}</strong>부터 시행됩니다.
                        바뀐 내용은 각 문서 끝의 개정 이력에서 확인할 수 있어요.
                    </p>
                    <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 dark:bg-blue-900/20 dark:border-blue-800">
                        <p className="text-xs text-blue-700 dark:text-blue-400">
                            소속 <strong>기관이 개인정보처리자</strong>이며, 서비스 제공자는 기관의 위탁을 받아
                            개인정보를 처리하는 <strong>수탁자</strong>입니다. 기관 관리자로서 위탁에 동의해 주세요.
                        </p>
                    </div>
                    <p className="text-xs">
                        동의하시면 기관의 위탁 동의와 관리자 본인의 약관 동의가 함께 기록됩니다.
                    </p>
                </div>
                {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}
                <button
                    type="button"
                    onClick={accept}
                    disabled={submitting}
                    className="btn-primary w-full min-h-[48px]"
                >
                    {submitting ? '처리 중...' : '이용약관 및 개인정보 처리방침에 동의합니다'}
                </button>
            </div>
        </div>
    );
}
