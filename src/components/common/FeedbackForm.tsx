/**
 * FeedbackForm — 의견남기기 모달 컴포넌트
 * 텍스트 + 이미지(최대 3장) 첨부 가능
 */
import React, { useState, useRef, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { createFeedback } from '../../lib/firestore/feedbacks';
import { useAuth } from '../../hooks/useAuth';
import type { CreateFeedbackData } from '../../types/feedback';

interface FeedbackFormProps {
    onClose: () => void;
}

interface ImageFile {
    file: File;
    preview: string;
}

export default function FeedbackForm({ onClose }: FeedbackFormProps) {
    const { user, userData } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 모달 열릴 때 의견 내용 textarea에 포커스
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    const [message, setMessage] = useState('');
    const [images, setImages] = useState<ImageFile[]>([]); // { file, preview }
    const [sending, setSending] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    const compressImage = (file: File): Promise<Blob> => {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                const maxSize = 1200;
                let { width, height } = img;
                if (width > height && width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                } else if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }
                canvas.width = width;
                canvas.height = height;
                ctx?.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                }, 'image/jpeg', 0.7);
            };
            img.src = URL.createObjectURL(file);
        });
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (images.length + files.length > 3) {
            setError('이미지는 최대 3장까지 첨부할 수 있습니다.');
            return;
        }

        for (const file of files) {
            if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
                setError('JPG 또는 PNG 이미지만 업로드 가능합니다.');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                setError('이미지 크기는 5MB 이하여야 합니다.');
                return;
            }
        }

        setError('');
        const newImages = files.map(file => ({
            file,
            preview: URL.createObjectURL(file),
        }));
        setImages(prev => [...prev, ...newImages]);

        // 파일 입력 리셋
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeImage = (index: number) => {
        setImages(prev => {
            const removed = prev[index];
            URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!message.trim()) {
            setError('의견을 입력해주세요.');
            return;
        }

        if (!user) {
            setError('로그인이 필요합니다.');
            return;
        }

        setSending(true);
        setError('');

        try {
            // 이미지 업로드
            const imageUrls: string[] = [];
            for (let i = 0; i < images.length; i++) {
                const compressed = await compressImage(images[i].file);
                const timestamp = Date.now();
                const storageRef = ref(storage, `feedbacks/${user.uid}/${timestamp}_${i}.jpg`);
                await uploadBytes(storageRef, compressed);
                const url = await getDownloadURL(storageRef);
                imageUrls.push(url);
            }

            // Firestore에 피드백 저장
            const feedbackData: CreateFeedbackData = {
                message: message.trim(),
                imageUrls,
                userEmail: user.email || '',
                userName: user.displayName || userData?.name || '',
                organizationId: userData?.organizationId || '',
            };

            await createFeedback(feedbackData);

            setSuccess(true);

            // 2초 후 자동 닫기
            setTimeout(() => {
                onClose?.();
            }, 2000);
        } catch (err) {
            console.error('피드백 전송 실패:', err);
            setError('전송 중 오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setSending(false);
        }
    };

    if (success) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
                <div className="bg-white dark:bg-surface-800 rounded-2xl p-8 max-w-sm mx-4 text-center animate-scale-in" onClick={e => e.stopPropagation()}>
                    <div className="w-16 h-16 mx-auto mb-4 bg-accent-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-accent-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-1">의견이 전송되었습니다!</h3>
                    <p className="text-sm text-surface-500 dark:text-surface-400">소중한 의견 감사합니다.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="bg-white dark:bg-surface-800 rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto animate-scale-in"
                onClick={e => e.stopPropagation()}
            >
                {/* 헤더 */}
                <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700">
                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">개발자에게 의견남기기</h2>
                    <button onClick={onClose} className="btn-icon text-surface-400 hover:text-surface-600 dark:text-surface-400">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* 폼 */}
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="label">의견 내용 <span className="text-red-500">*</span></label>
                        <textarea
                            ref={textareaRef}
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            className="input min-h-[120px] resize-y"
                            placeholder="개선 사항, 요청 기능, 오류 신고 등 자유롭게 작성해주세요."
                            maxLength={2000}
                        />
                        <p className="text-xs text-surface-400 mt-1 text-right">{message.length}/2000</p>
                    </div>

                    {/* 이미지 첨부 */}
                    <div>
                        <label className="label">이미지 첨부 (선택, 최대 3장)</label>
                        <div className="flex gap-3 flex-wrap">
                            {images.map((img, idx) => (
                                <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border border-surface-200 dark:border-surface-600 group">
                                    <img src={img.preview} alt={`첨부 ${idx + 1}`} className="w-full h-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => removeImage(idx)}
                                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            ))}

                            {images.length < 3 && (
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-20 h-20 rounded-xl border-2 border-dashed border-surface-200 dark:border-surface-600 hover:border-primary-300 hover:bg-primary-50/30 flex flex-col items-center justify-center transition-all"
                                >
                                    <svg className="w-6 h-6 text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                    </svg>
                                    <span className="text-[10px] text-surface-400 mt-0.5">추가</span>
                                </button>
                            )}
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png"
                            multiple
                            onChange={handleImageChange}
                            className="hidden"
                        />
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 animate-slide-down">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="btn-secondary flex-1">
                            취소
                        </button>
                        <button type="submit" disabled={sending} className="btn-primary flex-1">
                            {sending ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 spinner" />전송 중...
                                </span>
                            ) : '의견 보내기'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
