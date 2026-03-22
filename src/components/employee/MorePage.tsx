/**
 * MorePage — 더보기 페이지
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../lib/auth';
import { useTheme } from '../../hooks/useTheme';
import { useFontSize } from '../../hooks/useFontSize';
import { leaveOrganization, getVehicles } from '../../lib/firestore';
import useNotification from '../../hooks/useNotification';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import FeedbackForm from '../common/FeedbackForm';
import UserManual from '../common/UserManual';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import type { Vehicle } from '../../types/vehicle';

export default function MorePage() {
    const { user, userData } = useAuth();
    const navigate = useNavigate();
    const [showFeedback, setShowFeedback] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const { permission, requestPermission } = useNotification();
    const { isDark, toggleTheme } = useTheme();
    const { fontSize, setSize } = useFontSize();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [navApp, setNavApp] = useState(() => {
        try { return localStorage.getItem('preferred-nav-app') || 'naver'; } catch { return 'naver'; }
    });
    const [showInsurance, setShowInsurance] = useState(false);
    const [insuranceVehicles, setInsuranceVehicles] = useState<Vehicle[]>([]);

    const notifApiAvailable = typeof window !== 'undefined' && 'Notification' in window;

    useEffect(() => {
        if (!showInsurance || !userData?.organizationId) return;
        getVehicles(userData.organizationId).then((list: Vehicle[]) => {
            setInsuranceVehicles(list.filter(v => !v.retired?.isRetired && v.insurance?.company));
        }).catch(() => { });
    }, [showInsurance, userData?.organizationId]);

    return (
        <div className="max-w-lg mx-auto animate-fade-in space-y-3">
            <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">더보기</h1>

            {/* 로그인 계정 정보 */}
            <div className="glass-card p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-surface-800 dark:text-surface-200 truncate">{userData?.name || user?.displayName || '사용자'}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{user?.email || ''}</p>
                </div>
                <button onClick={logout} className="flex-shrink-0 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" /></svg>
                    로그아웃
                </button>
            </div>

            <div className="glass-card divide-y divide-surface-100 dark:divide-surface-700">
                <button onClick={() => navigate('/employee/favorites')} className="w-full flex items-center gap-3 p-4 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left">
                    <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>
                    <span className="text-sm text-surface-700 dark:text-surface-300">목적지 즐겨찾기</span>
                </button>
                <button onClick={() => navigate('/employee/vehicle-history')} className="w-full flex items-center gap-3 p-4 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left">
                    <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></svg>
                    <span className="text-sm text-surface-700 dark:text-surface-300">차량 이용 내역</span>
                </button>
                <button onClick={() => setShowInsurance(!showInsurance)} className="w-full flex items-center gap-3 p-4 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left">
                    <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>
                    <span className="text-sm text-surface-700 dark:text-surface-300">차량 보험 정보</span>
                    <svg className={`w-4 h-4 ml-auto text-surface-400 transition-transform ${showInsurance ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                </button>
                {showInsurance && (
                    <div className="px-4 pb-3 animate-fade-in">
                        {insuranceVehicles.length === 0 ? (
                            <p className="text-xs text-surface-400 py-2">등록된 보험 정보가 없습니다</p>
                        ) : (
                            <div className="space-y-2">
                                {insuranceVehicles.map(v => (
                                    <div key={v.id} className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                                        <div className="flex items-center gap-2.5">
                                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${getVehicleColor(v.id)}`}>{VEHICLE_TYPE_ICONS[v.vehicleType as keyof typeof VEHICLE_TYPE_ICONS] || '🚗'}</span>
                                            <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{v.displayName}</p>
                                            <div className="ml-auto flex items-center gap-2 text-xs flex-shrink-0">
                                                <span className="text-surface-500 dark:text-surface-400">🛡️ {v.insurance?.company}</span>
                                                {v.insurance?.phone && (<a href={`tel:${v.insurance.phone}`} className="text-primary-500 font-medium hover:underline">📞 {v.insurance.phone}</a>)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <button onClick={() => setShowManual(true)} className="w-full flex items-center gap-3 p-4 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-left">
                    <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                    <span className="text-sm text-blue-600 dark:text-blue-400">사용 설명서</span>
                </button>
                <button onClick={() => setShowFeedback(true)} className="w-full flex items-center gap-3 p-4 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors text-left">
                    <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                    <span className="text-sm text-primary-600 dark:text-primary-400">개발자에게 의견남기기</span>
                </button>
                {/* 알림 설정 */}
                {notifApiAvailable && (
                    <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors" onClick={() => {
                        if (permission === 'default') { requestPermission(); }
                        else {
                            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                            const isAndroid = /Android/.test(navigator.userAgent);
                            if (isIOS) showToast('설정 → 알림에서 이 앱의 알림을 변경할 수 있습니다.', 'info');
                            else if (isAndroid) showToast('앱 아이콘을 길게 눌러 앱 정보 → 알림에서 변경할 수 있습니다.', 'info');
                            else showToast('주소창 왼쪽 🔒 아이콘을 눌러 알림을 변경할 수 있습니다.', 'info');
                        }
                    }}>
                        <div className="flex items-center gap-3">
                            <svg className={`w-5 h-5 ${permission === 'granted' ? 'text-blue-500' : 'text-surface-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
                            <span className="text-sm text-surface-700 dark:text-surface-300">알림</span>
                        </div>
                        {permission === 'default' ? (<span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">활성화</span>)
                            : permission === 'granted' ? (<span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">켜짐</span>)
                                : (<span className="text-xs font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2.5 py-1 rounded-full">꺼짐</span>)}
                    </div>
                )}
                {/* 다크 모드 토글 */}
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                        {isDark ? (<svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>)
                            : (<svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>)}
                        <span className="text-sm text-surface-700 dark:text-surface-300">{isDark ? '다크 모드' : '라이트 모드'}</span>
                    </div>
                    <button onClick={toggleTheme} className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none ${isDark ? 'bg-primary-600' : 'bg-surface-200'}`}>
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${isDark ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* 내비게이션 앱 선택 */}
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-surface-400 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                        <div><span className="text-sm text-surface-700 dark:text-surface-300">길안내 앱</span><p className="text-[11px] text-surface-400 dark:text-surface-500">네이버맵만 경유지 가능</p></div>
                    </div>
                    <div className="flex rounded-lg border border-surface-200 dark:border-surface-600 overflow-hidden">
                        {[{ key: 'naver', label: '네이버' }, { key: 'kakao', label: '카카오' }, { key: 'tmap', label: '티맵' }].map(opt => (
                            <button key={opt.key} onClick={() => { try { localStorage.setItem('preferred-nav-app', opt.key); } catch { /* */ } setNavApp(opt.key); }} className={`px-3 py-1.5 text-xs font-medium transition-colors ${navApp === opt.key ? 'bg-primary-600 text-white' : 'bg-surface-50 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-600'}`}>{opt.label}</button>
                        ))}
                    </div>
                </div>
                {/* 글자 크기 */}
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" /></svg>
                        <span className="text-sm text-surface-700 dark:text-surface-300">글자 크기</span>
                    </div>
                    <div className="flex rounded-lg border border-surface-200 dark:border-surface-600 overflow-hidden">
                        {[{ key: 'small', label: '작게' }, { key: 'normal', label: '보통' }, { key: 'large', label: '크게' }].map(opt => (
                            <button key={opt.key} onClick={() => setSize(opt.key as 'small' | 'normal' | 'large')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${fontSize === opt.key ? 'bg-primary-600 text-white' : 'bg-surface-50 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-600'}`}>{opt.label}</button>
                        ))}
                    </div>
                </div>
                <button onClick={async () => { if (!await confirm({ message: '정말 이 기관에서 나가시겠습니까?\n나가면 다시 초대 코드를 입력해야 합니다.', confirmColor: 'warning' })) return; await leaveOrganization(user!.uid); }} className="w-full flex items-center gap-3 p-4 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors text-left">
                    <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
                    <span className="text-sm text-orange-600 dark:text-orange-400">기관 나가기</span>
                </button>
            </div>

            {/* 제작자 정보 */}
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-surface-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" /></svg>
                <span>제작자: 소셜프리즘</span><span>·</span>
                <a href="mailto:ehsheh@gmail.com" className="text-primary-500 hover:text-primary-700 transition-colors">ehsheh@gmail.com</a>
            </div>

            {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
            {showManual && <UserManual role="employee" onClose={() => setShowManual(false)} />}
        </div>
    );
}
