/**
 * AdminNotice — 관리자 공지사항 전송 컴포넌트
 * 기관 전체 직원에게 공지 알림을 전송합니다.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { getFunctions, httpsCallable } from 'firebase/functions';

export default function AdminNotice() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const titleRef = useRef(null);

    useEffect(() => {
        if (isOpen) setTimeout(() => titleRef.current?.focus(), 100);
    }, [isOpen]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!title.trim() || !message.trim()) {
            showToast('제목과 내용을 모두 입력해주세요.', 'error');
            return;
        }

        setSending(true);
        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const sendNotice = httpsCallable(functions, 'sendAdminNotice');
            await sendNotice({
                orgId: userData.organizationId,
                title: title.trim(),
                message: message.trim(),
            });

            showToast('공지사항이 전송되었습니다.', 'success');
            setTitle('');
            setMessage('');
            setIsOpen(false);
        } catch (err) {
            console.error('공지 전송 실패:', err);
            showToast('공지 전송에 실패했습니다.', 'error');
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="btn-icon text-surface-500 hover:text-primary-600"
                title="공지 보내기"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
                </svg>
            </button>

            {isOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => !sending && setIsOpen(false)}>
                    <div
                        className="bg-white dark:bg-surface-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100">📢 공지사항 보내기</h3>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="btn-icon text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
                                aria-label="닫기"
                                disabled={sending}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
                            기관 소속 전체 직원에게 알림이 전송됩니다.
                        </p>

                        <form onSubmit={handleSend} className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">제목</label>
                                <input
                                    ref={titleRef}
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="공지 제목을 입력하세요"
                                    className="input w-full"
                                    maxLength={100}
                                    disabled={sending}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">내용</label>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="공지 내용을 입력하세요"
                                    className="input w-full"
                                    rows={4}
                                    maxLength={500}
                                    disabled={sending}
                                />
                                <p className="text-xs text-surface-400 mt-1 text-right">{message.length}/500</p>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    className="btn-secondary flex-1"
                                    disabled={sending}
                                >
                                    취소
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex-1"
                                    disabled={sending}
                                >
                                    {sending ? '전송 중...' : '📢 공지 전송'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
