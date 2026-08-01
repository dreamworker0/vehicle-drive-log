/**
 * BroadcastNoticePage — 전체 기관 일괄 공지 (슈퍼관리자 전용)
 *
 * 기관 관리자의 공지(AdminNotice)는 자기 기관에만 간다. 약관 개정 시행처럼
 * 서비스 전역에 알려야 하는 건은 이 화면이 담당한다.
 *
 * ## 되돌릴 수 없다는 전제로 만든 흐름
 * 한 번 보내면 수백~수천 명의 알림함에 남고 푸시가 울린다. 그래서 발송 버튼을
 * 바로 두지 않고 **[대상 확인] → 인원 표시 → [발송]** 2단계로 강제한다.
 * 본문을 고치면 확인 결과를 지워 다시 확인하게 한다 — 확인한 문안과 보내는 문안이
 * 달라지는 것이 이 화면에서 가장 위험한 실수다.
 */
import { useState, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../lib/firebase';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import { captureError } from '../../lib/sentry';
import { TERMS_VERSION, formatLegalVersion } from '../../lib/constants';

const MAX_TITLE = 100;
const MAX_MESSAGE = 1000;

/** 서버의 NOTICE_ID_PATTERN(`[A-Za-z0-9_-]{8,64}`)을 만족하는 난수 */
function newNoticeId(): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 약관 개정 시행 공지 기본 문안 — 시행일은 상수에서 파생시켜 본문과 어긋나지 않게 한다. */
const TEMPLATE_TITLE = '이용약관 개정 안내';
const TEMPLATE_MESSAGE =
    `이용약관과 개인정보 처리방침이 ${formatLegalVersion(TERMS_VERSION)}부터 개정 시행됩니다. ` +
    '화면 아래 안내 배너에서 [확인했습니다]를 눌러 주세요. 업무는 그대로 이어서 하실 수 있습니다. ' +
    '개인정보 수집·이용에 관한 안내는 소속 기관에서 받으시게 되며, ' +
    "전문은 앱 하단 '이용약관·개인정보 처리방침'에서 보실 수 있습니다.";

interface PreviewResult {
    recipientCount: number;
    pushableCount: number;
}

export default function BroadcastNoticePage() {
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const [title, setTitle] = useState(TEMPLATE_TITLE);
    const [message, setMessage] = useState(TEMPLATE_MESSAGE);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [busy, setBusy] = useState(false);

    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    const valid = useMemo(
        () =>
            trimmedTitle.length > 0 && trimmedTitle.length <= MAX_TITLE &&
            trimmedMessage.length > 0 && trimmedMessage.length <= MAX_MESSAGE,
        [trimmedTitle, trimmedMessage]
    );

    /** 문안이 바뀌면 확인 결과를 버린다 — 확인한 문안과 보내는 문안이 같아야 한다. */
    const editTitle = (v: string) => { setTitle(v); setPreview(null); };
    const editMessage = (v: string) => { setMessage(v); setPreview(null); };

    const callBroadcast = (payload: Record<string, unknown>) =>
        httpsCallable(firebaseFunctions, 'sendBroadcastNotice')(payload);

    const handlePreview = async () => {
        setBusy(true);
        try {
            const res = await callBroadcast({
                title: trimmedTitle,
                message: trimmedMessage,
                noticeId: newNoticeId(),
                dryRun: true,
            });
            setPreview(res.data as PreviewResult);
        } catch (err) {
            captureError(err, { context: 'BroadcastNoticePage.preview' });
            showToast('대상 확인에 실패했습니다.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleSend = async () => {
        if (!preview) return;

        const ok = await confirm({
            title: '전체 공지를 발송할까요?',
            message:
                `${preview.recipientCount}명에게 앱 내 알림이 남고, 그중 ${preview.pushableCount}명에게 푸시가 발송됩니다. ` +
                '발송 후에는 취소할 수 없습니다.',
            confirmText: '발송',
            confirmColor: 'warning',
        });
        if (!ok) return;

        setBusy(true);
        try {
            const res = await callBroadcast({
                title: trimmedTitle,
                message: trimmedMessage,
                // 발송마다 새 식별자 — 같은 문안을 의도적으로 재발송하는 경우를 막지 않는다.
                noticeId: newNoticeId(),
            });
            const { recipientCount, pushSent, pushFailed } = res.data as {
                recipientCount: number; pushSent: number; pushFailed: number;
            };
            showToast(
                `${recipientCount}명에게 발송했습니다. (푸시 성공 ${pushSent}` +
                (pushFailed > 0 ? ` · 실패 ${pushFailed}` : '') + ')',
                'success'
            );
            setPreview(null);
        } catch (err) {
            captureError(err, { context: 'BroadcastNoticePage.send' });
            showToast('공지 발송에 실패했습니다.', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 mb-1">전체 공지</h1>
                <p className="text-sm text-surface-500 dark:text-surface-400">
                    승인된 전체 기관의 관리자·직원에게 앱 내 알림과 푸시를 보냅니다.
                    비활성 계정과 기관 미소속 계정은 제외됩니다.
                </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                    ⚠️ 발송한 공지는 <strong>취소할 수 없습니다.</strong> [대상 확인]으로 인원을 먼저 확인한 뒤 발송하세요.
                    내용을 수정하면 확인 결과가 초기화됩니다.
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <label htmlFor="notice-title" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                        제목
                    </label>
                    <input
                        id="notice-title"
                        type="text"
                        value={title}
                        maxLength={MAX_TITLE}
                        onChange={(e) => editTitle(e.target.value)}
                        className="input w-full min-h-[48px]"
                        placeholder="공지 제목"
                    />
                    <p className="mt-1 text-xs text-surface-400 dark:text-surface-500 text-right">
                        {trimmedTitle.length} / {MAX_TITLE}
                    </p>
                </div>

                <div>
                    <label htmlFor="notice-message" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                        내용
                    </label>
                    <textarea
                        id="notice-message"
                        value={message}
                        maxLength={MAX_MESSAGE}
                        rows={7}
                        onChange={(e) => editMessage(e.target.value)}
                        className="input w-full resize-y"
                        placeholder="공지 내용"
                    />
                    <p className="mt-1 text-xs text-surface-400 dark:text-surface-500 text-right">
                        {trimmedMessage.length} / {MAX_MESSAGE}
                    </p>
                </div>
            </div>

            {preview && (
                <div
                    role="status"
                    className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-800 dark:bg-primary-900/20"
                >
                    <p className="text-sm text-primary-800 dark:text-primary-300">
                        수신 대상 <strong>{preview.recipientCount}명</strong>
                        <span className="text-xs"> · 푸시 가능 {preview.pushableCount}명</span>
                    </p>
                    <p className="mt-1 text-xs text-primary-700 dark:text-primary-400">
                        푸시 알림을 허용하지 않은 분에게도 앱 내 알림은 남습니다.
                    </p>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handlePreview}
                    disabled={busy || !valid}
                    className="btn-secondary min-h-[48px]"
                >
                    {busy && !preview ? '확인 중...' : '대상 확인'}
                </button>
                <button
                    type="button"
                    onClick={handleSend}
                    disabled={busy || !valid || !preview}
                    className="btn-primary min-h-[48px]"
                >
                    {busy && preview ? '발송 중...' : '발송'}
                </button>
            </div>

            {!preview && (
                <p className="text-xs text-surface-400 dark:text-surface-500">
                    발송하려면 먼저 [대상 확인]을 눌러 인원을 확인하세요.
                </p>
            )}
        </div>
    );
}
