/**
 * WithdrawOrgModal — 기관 서비스 해지(자발적 탈퇴) 모달
 * 사유 선택 + (기타 시 상세) + 기관명 확인 입력 후 해지 진행
 */
import { useState } from 'react';
import { WITHDRAW_REASON_LABELS } from '../../types/organization';
import type { WithdrawReason } from '../../types/organization';

interface WithdrawOrgModalProps {
    orgName: string;
    submitting: boolean;
    onClose: () => void;
    onConfirm: (reason: WithdrawReason, reasonDetail?: string) => void;
}

const REASON_ORDER: WithdrawReason[] = ['no_longer_needed', 'too_difficult', 'missing_features', 'other'];

export default function WithdrawOrgModal({ orgName, submitting, onClose, onConfirm }: WithdrawOrgModalProps) {
    const [reason, setReason] = useState<WithdrawReason | null>(null);
    const [detail, setDetail] = useState('');
    const [confirmName, setConfirmName] = useState('');

    const nameMatches = confirmName.trim() === orgName.trim();
    const detailRequired = reason === 'other';
    const detailValid = !detailRequired || detail.trim().length > 0;
    const canSubmit = !!reason && nameMatches && detailValid && !submitting;

    const handleSubmit = () => {
        if (!canSubmit || !reason) return;
        onConfirm(reason, reason === 'other' ? detail.trim() : undefined);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={onClose}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
        >
            <div
                className="bg-white dark:bg-surface-800 rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto animate-scale-in"
                onClick={e => e.stopPropagation()}
                role="presentation"
                onKeyDown={(e) => e.stopPropagation()}
            >
                {/* 헤더 */}
                <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700">
                    <h2 className="text-lg font-bold text-red-600 dark:text-red-400">서비스 해지</h2>
                    <button onClick={onClose} aria-label="닫기" className="btn-icon text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 dark:text-surface-400 min-w-[48px] min-h-[48px] flex items-center justify-center">
                        <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {/* 경고 안내 */}
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300 space-y-1">
                        <p className="font-semibold">정말 서비스를 해지하시겠습니까?</p>
                        <ul className="list-disc list-inside text-xs space-y-0.5">
                            <li>모든 직원의 접근이 즉시 차단됩니다.</li>
                            <li>해지 후 30일간 데이터를 보관하며, 복구는 운영자(슈퍼관리자)에게 문의해야 합니다.</li>
                            <li>30일이 지나면 데이터가 영구 삭제됩니다.</li>
                        </ul>
                    </div>

                    {/* 사유 선택 */}
                    <div>
                        <label className="label">해지 사유 <span className="text-red-500 dark:text-red-400">*</span></label>
                        <div className="space-y-2">
                            {REASON_ORDER.map((r) => (
                                <label
                                    key={r}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors min-h-[48px]
                                        ${reason === r
                                            ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                                            : 'border-surface-200 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-700'}`}
                                >
                                    <input
                                        type="radio"
                                        name="withdrawReason"
                                        value={r}
                                        checked={reason === r}
                                        onChange={() => setReason(r)}
                                        className="accent-red-500"
                                    />
                                    <span className="text-sm text-surface-800 dark:text-surface-100">{WITHDRAW_REASON_LABELS[r]}</span>
                                </label>
                            ))}
                        </div>
                        {reason === 'other' && (
                            <textarea
                                value={detail}
                                onChange={e => setDetail(e.target.value)}
                                className="input min-h-[80px] resize-y mt-2"
                                placeholder="해지 사유를 입력해주세요."
                                maxLength={500}
                            />
                        )}
                    </div>

                    {/* 기관명 확인 */}
                    <div>
                        <label className="label">
                            확인을 위해 기관명 <span className="font-bold text-surface-900 dark:text-surface-100">{orgName}</span> 을(를) 입력하세요 <span className="text-red-500 dark:text-red-400">*</span>
                        </label>
                        <input
                            type="text"
                            value={confirmName}
                            onChange={e => setConfirmName(e.target.value)}
                            className="input min-h-[48px]"
                            placeholder={orgName}
                            autoComplete="off"
                        />
                    </div>

                    {/* 액션 */}
                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary flex-1 min-h-[48px]">
                            취소
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                            className="flex-1 min-h-[48px] rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                        >
                            {submitting ? (<><span className="w-4 h-4 spinner" />해지 중...</>) : '서비스 해지'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
