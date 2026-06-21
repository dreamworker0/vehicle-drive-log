/**
 * Settings — 기관 설정 페이지
 * 로직은 useSettings 훅, 공휴일 관리는 HolidayManager 사용
 */
import useSettings from '../../hooks/useSettings';
import useSettingsModals from '../../hooks/useSettingsModals';

import HolidayManager from './HolidayManager';
import WithdrawOrgModal from './WithdrawOrgModal';
import FeedbackForm from '../common/FeedbackForm';
import UserManual from '../common/UserManual';
import AskAIModal from '../common/AskAIModal';
import OrgInfoSection from './settings/OrgInfoSection';
import ReservationApprovalSection from './settings/ReservationApprovalSection';
import ApprovalLineSection from './settings/ApprovalLineSection';
import AccountSection from './settings/AccountSection';

export default function Settings() {
    const {
        org, orgId, loading, saving, success, withdrawing,
        form, setForm,
        holidayYear, setHolidayYear,
        holidayForm, setHolidayForm,
        addingHoliday, publicHolidays,
        filteredCustomHolidays,
        handleSave, handlePhoneChange, handleAddHoliday, handleDeleteHoliday, handleWithdraw,
    } = useSettings();

    const {
        showFeedback, setShowFeedback,
        showManual, setShowManual,
        showAskAI, setShowAskAI,
        showWithdraw, setShowWithdraw,
    } = useSettingsModals();


    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">설정</h1>

            {success && (
                <div className="mb-4 p-4 rounded-xl bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-800/50 text-accent-700 dark:text-accent-400 text-sm flex items-center gap-2 animate-fade-in">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    저장되었습니다!
                </div>
            )}

            {/* 기관 관리 섹션 */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-3 px-1">기관 관리</h2>

            {/* 기관 정보 */}
            <OrgInfoSection
                form={form}
                setForm={setForm}
                handlePhoneChange={handlePhoneChange}
                handleSave={handleSave}
                saving={saving}
                onRequestFeedback={() => setShowFeedback(true)}
            />

            {/* 예약 승인 설정 */}
            <ReservationApprovalSection
                checked={form.requireReservationApproval}
                onChange={(next) => handleSave(null, { requireReservationApproval: next })}
            />

            {/* 결재 라인 설정 */}
            <ApprovalLineSection
                form={form}
                setForm={setForm}
                handleSave={handleSave}
                saving={saving}
            />


            <HolidayManager
                holidayYear={holidayYear}
                setHolidayYear={setHolidayYear}
                holidayForm={holidayForm}
                setHolidayForm={setHolidayForm}
                addingHoliday={addingHoliday}
                publicHolidays={publicHolidays}
                filteredCustomHolidays={filteredCustomHolidays}
                onAddHoliday={handleAddHoliday}
                onDeleteHoliday={handleDeleteHoliday}
            />

            {/* 앱 정보 섹션 */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mt-8 mb-3 px-1">앱 정보</h2>

            <div className="glass-card p-6 mb-6">
                {/* 사용 설명서 */}
                <button
                    onClick={() => setShowManual(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left"
                >
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">사용 설명서</p>
                        <p className="text-xs text-surface-400">관리자 기능 안내 보기</p>
                    </div>
                    <svg className="w-4 h-4 text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>

                <div className="border-t border-surface-100 dark:border-surface-700 my-3" />

                {/* AI에게 물어보기 */}
                <button
                    onClick={() => setShowAskAI(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left"
                >
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">AI에게 물어보기</p>
                        <p className="text-xs text-surface-400">앱 사용법이 궁금할 때 AI에게 물어보세요</p>
                    </div>
                    <svg className="w-4 h-4 text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>

                <div className="border-t border-surface-100 dark:border-surface-700 my-3" />

                {/* 건의하기 */}
                <button
                    onClick={() => setShowFeedback(true)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left"
                >
                    <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">개발자에게 건의하기</p>
                        <p className="text-xs text-surface-400">소셜프리즘 · ehsheh@gmail.com</p>
                    </div>
                    <svg className="w-4 h-4 text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>
            </div>

            {/* 내 계정 */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mt-8 mb-3 px-1">내 계정</h2>

            <AccountSection />

            {/* 기관 ID (읽기 전용) */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mt-8 mb-3 px-1">기관 정보 · 해지</h2>

            <div className="glass-card p-6 mb-6">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">기관 식별 정보</h2>
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <span className="text-surface-500 dark:text-surface-400">기관 ID</span>
                        <span className="font-mono text-surface-600 dark:text-surface-300 text-xs">{orgId}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <span className="text-surface-500 dark:text-surface-400">상태</span>
                        <span className="badge-success">{org?.status === 'approved' ? '승인됨' : org?.status}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <span className="text-surface-500 dark:text-surface-400">등록일</span>
                        <span className="text-surface-600 dark:text-surface-300">
                            {(() => {
                                const ca = org?.createdAt;
                                if (ca && typeof ca === 'object' && 'toDate' in ca && typeof (ca as { toDate?: unknown }).toDate === 'function') {
                                    return (ca as { toDate: () => Date }).toDate().toLocaleDateString('ko-KR');
                                }
                                return '-';
                            })()}
                        </span>
                    </div>
                </div>
            </div>

            {/* 서비스 해지 (Danger Zone) */}
            <div className="glass-card p-6 mb-6 border border-red-200 dark:border-red-900/50">
                <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-1">서비스 해지</h2>
                <p className="text-xs text-surface-400 mb-4">
                    기관의 서비스 이용을 종료합니다. 모든 직원의 접근이 차단되며, 30일간 보관 후 데이터가 영구 삭제됩니다.
                </p>
                <button
                    type="button"
                    onClick={() => setShowWithdraw(true)}
                    className="min-h-[48px] px-4 py-2 rounded-xl font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                >
                    서비스 해지하기
                </button>
            </div>

            {showWithdraw && (
                <WithdrawOrgModal
                    orgName={org?.name || form.name}
                    submitting={withdrawing}
                    onClose={() => setShowWithdraw(false)}
                    onConfirm={handleWithdraw}
                />
            )}
            {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
            {/* eslint-disable-next-line jsx-a11y/aria-role */}
            {showManual && <UserManual role="admin" onClose={() => setShowManual(false)} />}
            <AskAIModal isOpen={showAskAI} onClose={() => setShowAskAI(false)} />


        </div>
    );
}
