/**
 * EmployeeListItem — 직원 목록의 개별 행 컴포넌트
 * EmployeeManager에서 분리된 서브 컴포넌트
 */
import React from 'react';
import type { UserRole } from '../../types';

/** 통합 직원 목록 항목 타입 (EmployeeManager에서 가져온 형태와 일치해야 함) */
export interface UnifiedMember {
    id: string;
    memberStatus: 'active' | 'pending' | 'disabled';
    name?: string;
    email?: string;
    role?: string;
    original?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Props {
    member: UnifiedMember;
    selfUid?: string;
    editingId: string | null;
    editForm: { name: string; email: string };
    setEditForm: React.Dispatch<React.SetStateAction<{ name: string; email: string }>>;
    onEdit: (member: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    onSaveEdit: (uid: string) => void;
    onCancelEdit: () => void;
    onDelete: (member: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    onChangeRole: (member: any, role: UserRole) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    onDeletePreRegistered: (id: string) => void;
    onRestore: (member: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    onDeletePermanently: (member: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export default function EmployeeListItem({
    member,
    selfUid,
    editingId,
    editForm,
    setEditForm,
    onEdit,
    onSaveEdit,
    onCancelEdit,
    onDelete,
    onChangeRole,
    onDeletePreRegistered,
    onRestore,
    onDeletePermanently,
}: Props) {
    const isSelf = member.memberStatus === 'active' && !!selfUid && member.id === selfUid;
    const isActive = member.memberStatus === 'active';
    const isPending = member.memberStatus === 'pending';
    const isDisabled = member.memberStatus === 'disabled';
    const isActionDisabled = !selfUid || isSelf;

    const avatarBg = isDisabled
        ? 'bg-red-50 dark:bg-red-900/30'
        : isPending
            ? 'bg-amber-50 dark:bg-amber-900/30'
            : 'bg-primary-100 dark:bg-primary-900/30';
    const avatarText = isDisabled
        ? 'text-red-600 dark:text-red-400'
        : isPending
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-primary-700 dark:text-primary-400';

    const cardBorder = isDisabled
        ? 'border-l-4 border-red-400 dark:border-red-500'
        : isPending
            ? 'border-l-4 border-amber-400 dark:border-amber-500'
            : '';
    const cardOpacity = isDisabled || isPending ? 'opacity-80' : '';

    return (
        <div className={`glass-card p-4 hover:shadow-glass-lg transition-all ${cardBorder} ${cardOpacity}`}>
            {/* 편집 모드 (활성 직원만) */}
            {isActive && editingId === member.id ? (
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="text"
                        value={editForm.name}
                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        className="input flex-1"
                        placeholder="이름"
                    />
                    <div className="flex gap-2">
                        <button onClick={() => onSaveEdit(member.id)} className="btn-primary btn-sm min-h-[48px]">
                            저장
                        </button>
                        <button onClick={onCancelEdit} className="btn-secondary btn-sm min-h-[48px]">
                            취소
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-4">
                    {/* 아바타 */}
                    <div
                        className={`w-10 h-10 rounded-full ${avatarBg} flex items-center justify-center ${avatarText} font-bold flex-shrink-0`}
                    >
                        {(member.name || member.email || '?')[0]?.toUpperCase()}
                    </div>

                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-surface-900 dark:text-surface-100 truncate">
                                {member.name || '(이름 없음)'}
                            </p>
                            {isActive && (
                                <span
                                    className={`badge ${member.role === 'admin' ? 'badge-primary' : 'badge-neutral'}`}
                                >
                                    {member.role === 'admin' ? '관리자' : '직원'}
                                </span>
                            )}
                            {isPending && (
                                <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">
                                    가입 대기
                                </span>
                            )}
                            {isDisabled && (
                                <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 text-xs">
                                    비활성
                                </span>
                            )}
                            {isSelf && <span className="badge badge-neutral text-xs">나</span>}
                        </div>
                        {member.email && (
                            <p className="text-sm text-surface-400 dark:text-surface-500 truncate">{member.email}</p>
                        )}
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {/* 활성 직원: 역할 변경 + 편집 + 비활성화 */}
                        {isActive && (
                            <>
                                <select
                                    value={member.role || 'employee'}
                                    onChange={e =>
                                        onChangeRole(member.original, e.target.value as UserRole)
                                    }
                                    disabled={isActionDisabled}
                                    title={!selfUid ? '사용자 정보를 불러오는 중입니다' : isSelf ? '자신의 역할은 변경할 수 없습니다' : ''}
                                    className={`text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 min-h-[48px] bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${isActionDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                >
                                    <option value="employee">직원</option>
                                    <option value="admin">관리자</option>
                                </select>
                                <button
                                    onClick={() => onEdit(member.original)}
                                    className="btn-icon btn-sm text-surface-400 dark:text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 min-h-[48px] min-w-[48px]"
                                >
                                    <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        strokeWidth={1.5}
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
                                        />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => onDelete(member.original)}
                                    disabled={isActionDisabled}
                                    title={!selfUid ? '사용자 정보를 불러오는 중입니다' : isSelf ? '자기 자신은 비활성화할 수 없습니다' : ''}
                                    className={`btn-icon btn-sm min-h-[48px] min-w-[48px] ${isActionDisabled ? 'text-surface-200 dark:text-surface-700 cursor-not-allowed' : 'text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400'}`}
                                >
                                    <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        strokeWidth={1.5}
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                        />
                                    </svg>
                                </button>
                            </>
                        )}

                        {/* 가입 대기: 삭제만 */}
                        {isPending && (
                            <button
                                onClick={() => onDeletePreRegistered(member.id)}
                                className="btn-icon btn-sm text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 min-h-[48px] min-w-[48px]"
                                title="사전 등록 취소"
                            >
                                <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.5}
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                    />
                                </svg>
                            </button>
                        )}

                        {/* 비활성: 활성화 + 완전 삭제 */}
                        {isDisabled && (
                            <>
                                <button
                                    onClick={() => onRestore(member.original)}
                                    className="btn-sm text-xs px-3 py-1.5 bg-accent-50 text-accent-700 hover:bg-accent-100 dark:bg-accent-900/30 dark:text-accent-400 dark:hover:bg-accent-900/50 rounded-lg font-medium transition-colors min-h-[48px]"
                                >
                                    활성화
                                </button>
                                <button
                                    onClick={() => onDeletePermanently(member.original)}
                                    title="계정을 영구 삭제합니다 (운행 기록은 보존)"
                                    className="btn-icon btn-sm text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 min-h-[48px] min-w-[48px]"
                                >
                                    <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        strokeWidth={1.5}
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                        />
                                    </svg>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
