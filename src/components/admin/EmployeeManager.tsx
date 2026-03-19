/**
 * EmployeeManager — 직원 관리 페이지
 * 로직은 useEmployeeManager 훅 사용
 * Phase 29: 활성/가입대기/비활성 직원을 하나의 통합 목록으로 표시
 */
import useEmployeeManager from '../../hooks/useEmployeeManager';
import { useAuth } from '../../hooks/useAuth';
import { SkeletonList, SkeletonBox } from '../common/Skeleton';

export default function EmployeeManager() {
    const {
        organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        inviteCodeCopied, regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery,
        filteredUnifiedList, stats,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
        handleDeletePreRegistered, handleRestoreEmployee,
    } = useEmployeeManager();
    const { userData } = useAuth();
    const selfUid = userData?.uid;

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-28 mb-1" />
                <SkeletonBox className="h-4 w-40 mb-6" />
                <SkeletonList count={4} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">직원 관리</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        총 {stats.total}명
                        {stats.active > 0 && <> · 활성 {stats.active}명</>}
                        {stats.pending > 0 && <> · <span className="text-amber-600 dark:text-amber-400">가입 대기 {stats.pending}명</span></>}
                        {stats.disabled > 0 && <> · <span className="text-red-500 dark:text-red-400">비활성 {stats.disabled}명</span></>}
                    </p>
                </div>
                <button onClick={() => setShowAddForm(true)} className="btn-primary btn-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    직원 사전 등록
                </button>
            </div>

            {/* 초대 링크 섹션 */}
            <div className="glass-card p-5 mb-6">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400">직원 초대 링크</h3>
                        <div className="flex items-center gap-1">
                            <button onClick={handleCopyInviteCode} className={`btn-sm flex items-center gap-1.5 ${inviteCodeCopied ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400' : 'btn-primary'}`}>
                                {inviteCodeCopied ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                        </svg>
                                        복사됨
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                                        </svg>
                                        링크 복사
                                    </>
                                )}
                            </button>
                            <button onClick={handleRegenerateCode} disabled={regenerating} className="btn-ghost btn-sm text-surface-400 hover:text-amber-600" title="초대 코드 재발급">
                                <svg className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg px-4 py-2.5 font-mono text-sm text-surface-600 dark:text-surface-400 break-all select-all">
                        https://vehicle-drive-log.web.app?code={organization?.inviteCode || '------'}
                    </div>
                    <p className="text-xs text-surface-400">이 링크에는 기관 코드가 포함되어 있으므로, 반드시 소속 직원에게만 공유해 주세요</p>
                </div>
            </div>

            {/* 직원 사전 등록 폼 모달 */}
            {showAddForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <div className="glass-card p-6 w-full max-w-md animate-scale-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">직원 사전 등록</h3>
                            <button
                                type="button"
                                onClick={() => setShowAddForm(false)}
                                className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-700 transition-colors"
                                aria-label="닫기"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <p className="text-sm text-surface-500 dark:text-surface-400 mb-4">
                            직원 이름과 이메일을 미리 등록하면, 초대 코드로 가입 시 자동으로 이름이 설정됩니다.
                        </p>
                        <form onSubmit={handleAddEmployee} className="space-y-4">
                            <div>
                                <label className="label">이름 <span className="text-red-500">*</span></label>
                                <input type="text" value={newEmployee.name} onChange={e => setNewEmployee({ ...newEmployee, name: e.target.value })} className="input" placeholder="홍길동" required autoFocus />
                            </div>
                            <div>
                                <label className="label">이메일 <span className="text-red-500">*</span></label>
                                <input type="email" value={newEmployee.email} onChange={e => setNewEmployee({ ...newEmployee, email: e.target.value })} className="input" placeholder="example@gmail.com" required />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary flex-1">취소</button>
                                <button type="submit" className="btn-primary flex-1">등록</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 검색 */}
            {stats.total > 0 && (
                <div className="mb-4">
                    <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input pl-10" placeholder="이름, 이메일 검색" />
                    </div>
                </div>
            )}

            {/* 통합 직원 목록 */}
            {stats.total === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                    </svg>
                    <p className="text-surface-400 text-lg font-medium">등록된 직원이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">초대 링크를 직원들에게 공유하세요</p>
                </div>
            ) : filteredUnifiedList.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="text-surface-400 font-medium">검색 결과가 없습니다</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredUnifiedList.map((member) => {
                        const isSelf = member.memberStatus === 'active' && member.id === selfUid;
                        const isActive = member.memberStatus === 'active';
                        const isPending = member.memberStatus === 'pending';
                        const isDisabled = member.memberStatus === 'disabled';

                        // 아바타 색상
                        const avatarBg = isDisabled
                            ? 'bg-red-50 dark:bg-red-900/30'
                            : isPending
                                ? 'bg-amber-50 dark:bg-amber-900/30'
                                : 'bg-primary-100';
                        const avatarText = isDisabled
                            ? 'text-red-600 dark:text-red-400'
                            : isPending
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-primary-700';

                        // 카드 테두리
                        const cardBorder = isDisabled
                            ? 'border-l-4 border-red-400 dark:border-red-500'
                            : isPending
                                ? 'border-l-4 border-amber-400 dark:border-amber-500'
                                : '';
                        const cardOpacity = (isDisabled || isPending) ? 'opacity-80' : '';

                        return (
                            <div key={`${member.memberStatus}-${member.id}`} className={`glass-card p-4 hover:shadow-glass-lg transition-all ${cardBorder} ${cardOpacity}`}>
                                {/* 편집 모드 (활성 직원만) */}
                                {isActive && editingId === member.id ? (
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="input flex-1" placeholder="이름" autoFocus />
                                        <div className="flex gap-2">
                                            <button onClick={() => handleSaveEdit(member.id)} className="btn-primary btn-sm">저장</button>
                                            <button onClick={() => setEditingId(null)} className="btn-secondary btn-sm">취소</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-4">
                                        {/* 아바타 */}
                                        <div className={`w-10 h-10 rounded-full ${avatarBg} flex items-center justify-center ${avatarText} font-bold flex-shrink-0`}>
                                            {(member.name || member.email || '?')[0]?.toUpperCase()}
                                        </div>

                                        {/* 정보 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-medium text-surface-900 dark:text-surface-100 truncate">{member.name || '(이름 없음)'}</p>
                                                {isActive && (
                                                    <span className={`badge ${member.role === 'admin' ? 'badge-primary' : 'badge-neutral'}`}>
                                                        {member.role === 'admin' ? '관리자' : '직원'}
                                                    </span>
                                                )}
                                                {isPending && (
                                                    <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">가입 대기</span>
                                                )}
                                                {isDisabled && (
                                                    <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 text-xs">비활성</span>
                                                )}
                                                {isSelf && <span className="badge badge-neutral text-xs">나</span>}
                                            </div>
                                            {member.email && <p className="text-sm text-surface-400 truncate">{member.email}</p>}
                                        </div>

                                        {/* 액션 버튼 */}
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            {/* 활성 직원: 역할 변경 + 편집 + 비활성화 */}
                                            {isActive && (
                                                <>
                                                    <select
                                                        value={member.role}
                                                        onChange={(e) => handleChangeRole(member.original, e.target.value)}
                                                        disabled={isSelf}
                                                        title={isSelf ? '자신의 역할은 변경할 수 없습니다' : ''}
                                                        className={`text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                                                    >
                                                        <option value="employee">직원</option>
                                                        <option value="admin">관리자</option>
                                                    </select>
                                                    <button onClick={() => handleEditEmployee(member.original)} className="btn-icon btn-sm text-surface-400 hover:text-primary-600">
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteEmployee(member.original)}
                                                        disabled={isSelf}
                                                        title={isSelf ? '자기 자신은 삭제할 수 없습니다' : ''}
                                                        className={`btn-icon btn-sm ${isSelf ? 'text-surface-200 cursor-not-allowed' : 'text-surface-400 hover:text-red-500'}`}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                        </svg>
                                                    </button>
                                                </>
                                            )}

                                            {/* 가입 대기: 삭제만 */}
                                            {isPending && (
                                                <button
                                                    onClick={() => handleDeletePreRegistered(member.id)}
                                                    className="btn-icon btn-sm text-surface-400 hover:text-red-500"
                                                    title="사전 등록 취소"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                    </svg>
                                                </button>
                                            )}

                                            {/* 비활성: 활성화만 */}
                                            {isDisabled && (
                                                <button
                                                    onClick={() => handleRestoreEmployee(member.original)}
                                                    className="btn-sm text-xs px-3 py-1.5 bg-accent-50 text-accent-700 hover:bg-accent-100 dark:bg-accent-900/30 dark:text-accent-400 dark:hover:bg-accent-900/50 rounded-lg font-medium transition-colors"
                                                >
                                                    활성화
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
