import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../lib/firebase';
import toast from 'react-hot-toast';

interface PublicFeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function PublicFeedbackModal({ isOpen, onClose }: PublicFeedbackModalProps) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!name.trim()) return toast.error('이름을 입력해주세요.');
        if (!email.trim() || !email.includes('@')) return toast.error('유효한 이메일을 입력해주세요.');
        if (!message.trim()) return toast.error('문의하실 내용을 입력해주세요.');

        setIsSubmitting(true);
        const submitFn = httpsCallable(firebaseFunctions, 'submitPublicFeedback');

        try {
            await submitFn({
                userName: name.trim(),
                userEmail: email.trim(),
                message: message.trim(),
            });
            
            toast.success('문의가 접수되었습니다. 최대한 빠르게 답변해 드리겠습니다.', { duration: 4000 });
            setName('');
            setEmail('');
            setMessage('');
            onClose();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white dark:bg-surface-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-slide-up">
                {/* 헤더 */}
                <div className="flex items-center justify-between p-6 border-b border-surface-200 dark:border-surface-700">
                    <h2 className="text-xl font-bold text-surface-900 dark:text-white">문의하기 / 의견 보내기</h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-full transition-colors"
                        aria-label="닫기"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* 폼 콘텐츠 */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <p className="text-sm text-surface-600 dark:text-surface-300">
                        기관 등록 문제, 오류 제보, 혹은 서비스와 관련된 문의를 남겨주세요.<br />
                        남겨주신 이메일로 답변해 드립니다.
                    </p>
                    
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
                            이름 (또는 기관명) <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            placeholder="이름이나 기관명을 입력해주세요"
                            className="w-full px-4 py-2 border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-700/50 text-surface-900 dark:text-white focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all"
                            value={name}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />
                    </div>
                    
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
                            답변 받을 이메일 주소 <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            placeholder="example@email.com"
                            className="w-full px-4 py-2 border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-700/50 text-surface-900 dark:text-white focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all"
                            value={email}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
                            문의 내용 <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            className="w-full px-4 py-2 border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-700/50 text-surface-900 dark:text-white focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all resize-none min-h-[120px]"
                            placeholder="어떤 점이 불편하신가요? 구체적으로 적어주실수록 정확한 안내가 가능합니다."
                            value={message}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full btn bg-primary-600 hover:bg-primary-700 text-white !py-3 rounded-xl font-bold transition-all disabled:opacity-50"
                        >
                            {isSubmitting ? '전송 중...' : '신청 / 문의 보내기'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
