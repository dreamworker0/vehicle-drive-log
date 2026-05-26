/**
 * EmployeeManager — 직원 관리 페이지
 * 로직은 useEmployeeManager 훅 사용
 * Phase 29: 활성/가입대기/비활성 직원을 하나의 통합 목록으로 표시
 */
import useEmployeeManager from '../../hooks/useEmployeeManager';
import { useAuth } from '../../hooks/useAuth';
import { SkeletonList, SkeletonBox } from '../common/Skeleton';
import EmployeeListItem from './EmployeeListItem';

export default function EmployeeManager() {
    const {
        organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        copiedType, regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery,
        filteredUnifiedList, stats,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
        handleDeletePreRegistered, handleRestoreEmployee,
    } = useEmployeeManager();
    const { userData } = useAuth();
    const selfUid = userData?.id;

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
                        <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400">직원 초대</h3>
                        <button onClick={handleRegenerateCode} disabled={regenerating} className="btn-ghost btn-sm text-surface-400 hover:text-amber-600" title="초대 코드 재발급">
                            <svg className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                            </svg>
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
                        {/* 초대 링크 */}
                        <div className="sm:col-span-2 bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700/50 p-3.5 flex flex-col justify-center relative group overflow-hidden">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">초대 링크</span>
                                <button onClick={() => handleCopyInviteCode('link')} className={`text-xs flex items-center gap-1 transition-colors ${copiedType === 'link' ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'}`}>
                                    {copiedType === 'link' ? (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                                            복사됨
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                                            링크 복사
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="font-mono text-sm text-surface-700 dark:text-surface-300 break-all select-all pr-2">
                                https://vehicle-drive-log.web.app?code={organization?.inviteCode || '------'}
                            </div>
                        </div>

                        {/* 초대 코드 */}
                        <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700/50 p-3.5 flex flex-col justify-center">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">기관 코드</span>
                                <button onClick={() => handleCopyInviteCode('code')} className={`text-xs flex items-center gap-1 transition-colors ${copiedType === 'code' ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'}`}>
                                    {copiedType === 'code' ? (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                                            복사됨
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
                                            코드 복사
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="font-mono text-lg font-bold text-primary-600 dark:text-primary-400 select-all">
                                {organization?.inviteCode || '------'}
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">이 링크 또는 기관 코드를 소속 직원에게 공유해 주세요. 직원 가입 시 자동으로 연결됩니다.</p>
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
                    <p className="text-sm text-surface-400 dark:text-surface-500 mt-1">초대 링크를 직원들에게 공유하세요</p>
                </div>
            ) : filteredUnifiedList.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="text-surface-400 font-medium">검색 결과가 없습니다</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredUnifiedList.map((member) => (
                        <EmployeeListItem
                            key={`${member.memberStatus}-${member.id}`}
                            member={member}
                            selfUid={selfUid}
                            editingId={editingId}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            onEdit={handleEditEmployee}
                            onSaveEdit={handleSaveEdit}
                            onCancelEdit={() => setEditingId(null)}
                            onDelete={handleDeleteEmployee}
                            onChangeRole={handleChangeRole}
                            onDeletePreRegistered={handleDeletePreRegistered}
                            onRestore={handleRestoreEmployee}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
