/**
 * EmployeeManager — 직원 관리 페이지
 * 로직은 useEmployeeManager 훅 사용
 */
import useEmployeeManager from '../../hooks/useEmployeeManager';
import { useAuth } from '../../hooks/useAuth';
import { SkeletonList, SkeletonBox } from '../common/Skeleton';

export default function EmployeeManager() {
    const {
        employees, organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        inviteCodeCopied, regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery,
        filteredEmployees, admins, regularEmployees,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
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
                        총 {employees.length}명 (관리자 {admins.length}명, 직원 {regularEmployees.length}명)
                    </p>
                </div>
                <button onClick={() => setShowAddForm(true)} className="btn-primary btn-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    직원 사전 등록
                </button>
            </div>

            {/* 초대 코드 섹션 */}
            <div className="glass-card p-5 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400 mb-1">기관 초대 코드</h3>
                        <p className="text-xs text-surface-400">직원들에게 https://vehicle-drive-log.web.app 링크와 이 초대 코드를 공유하면 이 앱을 함께 사용할 수 있습니다</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <code className="text-2xl font-mono font-bold tracking-[0.3em] text-primary-700 bg-primary-50 px-4 py-2 rounded-xl">
                            {organization?.inviteCode || '------'}
                        </code>
                        <button onClick={handleCopyInviteCode} className={`btn-icon ${inviteCodeCopied ? 'text-accent-600' : 'text-surface-400 hover:text-surface-600 dark:text-surface-400'}`} title="복사">
                            {inviteCodeCopied ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                                </svg>
                            )}
                        </button>
                        <button onClick={handleRegenerateCode} disabled={regenerating} className="btn-ghost btn-sm text-surface-400 hover:text-amber-600" title="재발급">
                            <svg className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* 직원 사전 등록 폼 모달 */}
            {showAddForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowAddForm(false)}>
                    <div className="glass-card p-6 w-full max-w-md animate-scale-in" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">직원 사전 등록</h3>
                        <p className="text-sm text-surface-500 dark:text-surface-400 mb-4">
                            직원 이름과 이메일을 미리 등록하면, 초대 코드로 가입 시 자동으로 이름이 설정됩니다.
                        </p>
                        <form onSubmit={handleAddEmployee} className="space-y-4">
                            <div>
                                <label className="label">이름 <span className="text-red-500">*</span></label>
                                <input type="text" value={newEmployee.name} onChange={e => setNewEmployee({ ...newEmployee, name: e.target.value })} className="input" placeholder="홍길동" required autoFocus />
                            </div>
                            <div>
                                <label className="label">이메일 (선택)</label>
                                <input type="email" value={newEmployee.email} onChange={e => setNewEmployee({ ...newEmployee, email: e.target.value })} className="input" placeholder="example@gmail.com" />
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
            {employees.length > 0 && (
                <div className="mb-4">
                    <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input pl-10" placeholder="이름, 이메일 검색" />
                    </div>
                </div>
            )}

            {/* 직원 목록 */}
            {employees.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                    </svg>
                    <p className="text-surface-400 text-lg font-medium">등록된 직원이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">초대 코드를 직원들에게 공유하세요</p>
                </div>
            ) : filteredEmployees.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🔍</div>
                    <p className="text-surface-400 font-medium">검색 결과가 없습니다</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredEmployees.map((emp) => (
                        <div key={emp.id} className="glass-card p-4 hover:shadow-glass-lg transition-all">
                            {editingId === emp.id ? (
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="input flex-1" placeholder="이름" autoFocus />
                                    <div className="flex gap-2">
                                        <button onClick={() => handleSaveEdit(emp.id)} className="btn-primary btn-sm">저장</button>
                                        <button onClick={() => setEditingId(null)} className="btn-secondary btn-sm">취소</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-4">
                                    {(() => {
                                        const isSelf = emp.id === selfUid; return (
                                            <>
                                                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold flex-shrink-0">
                                                    {(emp.name || emp.email || '?')[0]?.toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="font-medium text-surface-900 dark:text-surface-100 truncate">{emp.name || '(이름 없음)'}</p>
                                                        <span className={`badge ${emp.role === 'admin' ? 'badge-primary' : 'badge-neutral'}`}>
                                                            {emp.role === 'admin' ? '관리자' : '직원'}
                                                        </span>
                                                        {isSelf && <span className="badge badge-neutral text-xs">나</span>}
                                                    </div>
                                                    <p className="text-sm text-surface-400 truncate">{emp.email}</p>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <select
                                                        value={emp.role}
                                                        onChange={(e) => handleChangeRole(emp, e.target.value)}
                                                        disabled={isSelf}
                                                        title={isSelf ? '자신의 역할은 변경할 수 없습니다' : ''}
                                                        className={`text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                                                    >
                                                        <option value="employee">직원</option>
                                                        <option value="admin">관리자</option>
                                                    </select>
                                                    <button onClick={() => handleEditEmployee(emp)} className="btn-icon btn-sm text-surface-400 hover:text-primary-600">
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteEmployee(emp)}
                                                        disabled={isSelf}
                                                        title={isSelf ? '자기 자신은 삭제할 수 없습니다' : ''}
                                                        className={`btn-icon btn-sm ${isSelf ? 'text-surface-200 cursor-not-allowed' : 'text-surface-400 hover:text-red-500'}`}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
