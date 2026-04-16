/**
 * Settings — 기관 설정 페이지
 * 로직은 useSettings 훅, 공휴일 관리는 HolidayManager 사용
 */
import { useState } from 'react';
import useSettings from '../../hooks/useSettings';
import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../lib/auth';
import useNotification from '../../hooks/useNotification';
import { useToast } from '../../hooks/useToast';

import HolidayManager from './HolidayManager';
import FeedbackForm from '../common/FeedbackForm';
import UserManual from '../common/UserManual';
import AskAIModal from '../common/AskAIModal';

export default function Settings() {
    const { user } = useAuth();
    const {
        org, orgId, loading, saving, success,
        form, setForm,
        holidayYear, setHolidayYear,
        holidayForm, setHolidayForm,
        addingHoliday, publicHolidays,
        filteredCustomHolidays,
        handleSave, handlePhoneChange, handleAddHoliday, handleDeleteHoliday,
    } = useSettings();

    const [showFeedback, setShowFeedback] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const [showAskAI, setShowAskAI] = useState(false);
    const { permission, requestPermission } = useNotification();
    const { showToast } = useToast();
    const notifApiAvailable = typeof window !== 'undefined' && 'Notification' in window;


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
                <div className="mb-4 p-4 rounded-xl bg-accent-50 border border-accent-200 text-accent-700 text-sm flex items-center gap-2 animate-fade-in">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    저장되었습니다!
                </div>
            )}

            {/* 기관 관리 섹션 */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-3 px-1">기관 관리</h2>

            {/* 기관 정보 */}
            <div className="glass-card p-6 mb-6">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">기관 정보</h2>
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="label">기관명</label>
                        <input type="text" value={form.name} className="input opacity-60 cursor-not-allowed" disabled />
                    </div>
                    <div>
                        <label className="label">주소</label>
                        {form.address ? (
                            <input type="text" value={form.address} className="input opacity-60 cursor-not-allowed" disabled />
                        ) : (
                            <input
                                type="text"
                                value={form.address}
                                onChange={e => setForm({ ...form, address: e.target.value })}
                                className="input"
                                placeholder="AI가 주소를 읽지 못한 경우 직접 입력해주세요"
                            />
                        )}
                        <p className="text-xs text-surface-400 mt-1">
                            💡 주소를 입력하면 예약 시 목적지까지의 소요 시간, 거리, 톨게이트비가 자동으로 계산됩니다.
                        </p>
                    </div>
                    <div>
                        <label className="label">관리자 이메일</label>
                        <input type="email" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} className="input" />
                    </div>
                    <div>
                        <label className="label">전화번호</label>
                        <input type="tel" value={form.phone} onChange={handlePhoneChange} className="input" placeholder="010-0000-0000" />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowFeedback(true)}
                        className="text-xs text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 flex items-center gap-1 transition-colors"
                    >
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                        </svg>
                        기관명과 주소 변경은 슈퍼관리자에게 요청하세요.
                    </button>
                    <div className="flex justify-end">
                        <button type="submit" disabled={saving} className="btn-primary">
                            {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '변경사항 저장'}
                        </button>
                    </div>
                </form>
            </div>

            {/* 예약 승인 설정 */}
            <div className="glass-card p-6 mb-6">
                <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">예약 관리자 승인</h2>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className={`text-xs font-medium ${!form.requireReservationApproval ? 'text-surface-400' : 'text-primary-600 dark:text-primary-400'}`}>
                            {form.requireReservationApproval ? '사용' : '사용 안함'}
                        </span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={form.requireReservationApproval}
                            onClick={(e) => {
                                e.preventDefault();
                                handleSave(null, { requireReservationApproval: !form.requireReservationApproval });
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.requireReservationApproval ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${form.requireReservationApproval ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </label>
                </div>
                <p className="text-xs text-surface-400">
                    💡 사용 시 직원들의 차량 예약이 즉시 확정되지 않고, 관리자의 승인을 거쳐야 합니다.
                </p>
            </div>

            {/* 결재 라인 설정 */}
            <div className="glass-card p-6 mb-6">
                <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">결재 라인</h2>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className={`text-xs font-medium ${form.hideApprovalLine ? 'text-surface-400' : 'text-primary-600 dark:text-primary-400'}`}>
                            {form.hideApprovalLine ? 'PDF 결재란 숨김' : 'PDF 결재란 표시'}
                        </span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={!form.hideApprovalLine}
                            onClick={() => setForm({ ...form, hideApprovalLine: !form.hideApprovalLine })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${!form.hideApprovalLine ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${!form.hideApprovalLine ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </label>
                </div>
                <p className="text-xs text-surface-400 mb-4">PDF 운행일지에 표시될 결재란을 설정합니다. (수동 결재용)</p>

                <div className={`space-y-2 mb-3 transition-opacity ${form.hideApprovalLine ? 'opacity-40 pointer-events-none' : ''}`}>
                    {form.approvalLine.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={item.title}
                                onChange={e => {
                                    const next = [...form.approvalLine];
                                    next[idx] = { ...next[idx], title: e.target.value };
                                    setForm({ ...form, approvalLine: next });
                                }}
                                className="input text-sm flex-1"
                                placeholder="직급 (예: 담당, 팀장)"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const next = form.approvalLine.filter((_, i) => i !== idx);
                                    setForm({ ...form, approvalLine: next });
                                }}
                                className="text-red-400 hover:text-red-600 transition-colors p-1"
                                title="삭제"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>

                {form.approvalLine.length < 5 && !form.hideApprovalLine && (
                    <button
                        type="button"
                        onClick={() => setForm({ ...form, approvalLine: [...form.approvalLine, { title: '' }] })}
                        className="text-xs text-primary-500 hover:text-primary-700 dark:text-primary-400 font-medium transition-colors"
                    >
                        + 결재자 추가
                    </button>
                )}

                <div className="flex justify-end mt-4">
                    <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
                        {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '결재 라인 저장'}
                    </button>
                </div>
            </div>


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

            {/* 기관 ID (읽기 전용) */}
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

            {/* 내 계정 */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mt-8 mb-3 px-1">내 계정</h2>

            <div className="glass-card p-6 mb-6">
                <div className="flex items-center gap-3 p-3">
                    <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{user?.displayName || '이름 없음'}</p>
                        <p className="text-xs text-surface-400 truncate">{user?.email}</p>
                    </div>
                    <button
                        onClick={logout}
                        className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium text-red-500 dark:text-red-400 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                        로그아웃
                    </button>
                </div>

                {notifApiAvailable && (
                    <>
                        <div className="border-t border-surface-100 dark:border-surface-700 my-1 mx-3" />
                        <div
                            className="flex items-center justify-between cursor-pointer rounded-xl p-3 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                            onClick={() => {
                                if (permission === 'default') {
                                    requestPermission();
                                } else {
                                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                                    const isAndroid = /Android/.test(navigator.userAgent);
                                    if (isIOS) {
                                        showToast('설정 → 알림에서 이 앱의 알림을 변경할 수 있습니다.', 'info');
                                    } else if (isAndroid) {
                                        showToast('앱 아이콘을 길게 눌러 앱 정보 → 알림에서 변경할 수 있습니다.', 'info');
                                    } else {
                                        showToast('주소창 왼쪽 🔒 아이콘을 눌러 알림을 변경할 수 있습니다.', 'info');
                                    }
                                }
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${permission === 'granted' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-surface-100 dark:bg-surface-800'}`}>
                                    <svg className={`w-5 h-5 ${permission === 'granted' ? 'text-blue-500' : 'text-surface-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">푸시 알림</p>
                                    <p className="text-xs text-surface-400">예약 알림 및 운행 관련 알림</p>
                                </div>
                            </div>
                            {permission === 'default' ? (
                                <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">활성화</span>
                            ) : permission === 'granted' ? (
                                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">켜짐</span>
                            ) : (
                                <span className="text-xs font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2.5 py-1 rounded-full">꺼짐</span>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* 앱 정보 섹션 */}
            <h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mt-8 mb-3 px-1">앱 정보</h2>

            <div className="glass-card p-6">
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

            {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
            {showManual && <UserManual role="admin" onClose={() => setShowManual(false)} />}
            <AskAIModal isOpen={showAskAI} onClose={() => setShowAskAI(false)} />


        </div>
    );
}
