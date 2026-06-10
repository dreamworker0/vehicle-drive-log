/**
 * CalendarSyncTroubleshootModal — 캘린더 동기화 실패 전용 문제 해결 모달
 *
 * 기관 관리자가 "캘린더 동기화 실패" 배지를 클릭했을 때 표시됩니다.
 * 차량 수정 폼 전체를 열지 않고, 문제 진단·해결에 집중된 UI를 제공합니다.
 *
 * 포함 기능:
 *  - 실패 상태 요약 (실패 횟수, 차량명)
 *  - 서비스 계정 이메일 복사
 *  - 단계별 해결 가이드 (Google Workspace 주의사항 포함)
 *  - "🔄 연동 테스트" 버튼 + 인라인 결과 표시
 *  - "차량 수정으로 이동" 보조 액션
 */
import React, { useState } from 'react';
import { firebaseFunctions } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { Vehicle } from '../../types/vehicle';

const SERVICE_ACCOUNT_EMAIL = '1066541065552-compute@developer.gserviceaccount.com';

interface Props {
    vehicle: Vehicle;
    onClose: () => void;
    onGoToEdit: (vehicle: Vehicle) => void;
    onCalendarTestResult?: (vehicleId: string, success: boolean) => Promise<void>;
}

type TestResult = {
    success: boolean;
    message: string;
    errorType?: string;
    errorTitle?: string;
} | null;

export default function CalendarSyncTroubleshootModal({
    vehicle, onClose, onGoToEdit, onCalendarTestResult,
}: Props) {
    const [testLoading, setTestLoading] = useState(false);
    const [testResult, setTestResult] = useState<TestResult>(null);
    const [emailCopied, setEmailCopied] = useState(false);

    const failCount = vehicle.calendarSyncFailCount || 0;
    const calendarId = vehicle.googleCalendarId || '';

    const handleCopyEmail = () => {
        navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
        setEmailCopied(true);
        setTimeout(() => setEmailCopied(false), 2000);
    };

    const handleTest = async () => {
        if (!calendarId) return;
        setTestLoading(true);
        setTestResult(null);
        try {
            const fn = httpsCallable(firebaseFunctions, 'testCalendarAccess');
            const res = await fn({ calendarId });
            const result = res.data as TestResult;
            setTestResult(result);
            if (onCalendarTestResult) {
                await onCalendarTestResult(vehicle.id, result?.success ?? false);
            }
        } catch {
            const errResult: TestResult = {
                success: false,
                message: '테스트 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            };
            setTestResult(errResult);
            if (onCalendarTestResult) {
                await onCalendarTestResult(vehicle.id, false);
            }
        } finally {
            setTestLoading(false);
        }
    };

    return (
        <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
            <div
                role="presentation"
                className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in"
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
            >
                {/* ── 헤더 ── */}
                <div className="flex items-start justify-between p-6 pb-4 border-b border-surface-200 dark:border-surface-700">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-xl shrink-0">
                            📅
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">
                                캘린더 연동 문제 해결
                            </h2>
                            <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                                {vehicle.displayName}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-surface-400 dark:text-surface-500 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-700 transition-colors shrink-0 min-h-[48px]"
                        aria-label="닫기"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 space-y-5">

                    {/* ── 현재 상태 요약 ── */}
                    {testResult === null && (
                        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                                    ⚠️ 동기화 실패 감지됨
                                </span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-300">
                                    {failCount}회 연속 실패
                                </span>
                            </div>
                            <p className="text-xs text-red-600 dark:text-red-400">
                                Google 캘린더에 일정을 기록하지 못하고 있습니다.
                                아래 해결 방법을 따라 설정을 확인해주세요.
                            </p>
                        </div>
                    )}

                    {/* ── 연동 테스트 결과 ── */}
                    {testResult !== null && (
                        <div className={`p-3.5 rounded-xl border text-sm ${
                            testResult.success
                                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                        }`}>
                            <p className={`font-semibold mb-1 ${
                                testResult.success
                                    ? 'text-green-700 dark:text-green-400'
                                    : 'text-red-700 dark:text-red-400'
                            }`}>
                                {testResult.success ? '✅ 연동 정상 확인!' : `❌ ${testResult.errorTitle || '연동 실패'}`}
                            </p>
                            <p className="text-xs text-surface-600 dark:text-surface-400">
                                {testResult.message}
                            </p>
                            {testResult.success && (
                                <p className="text-xs text-green-600 dark:text-green-400 mt-2 font-medium">
                                    🎉 이제 차량 예약 시 Google 캘린더에 자동으로 기록됩니다.
                                </p>
                            )}
                        </div>
                    )}

                    {/* ── 주의사항: 새 캘린더 생성 권장 ── */}
                    <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                        <p className="font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5 mb-1">
                            <span className="text-sm">⚠️</span> 주의사항: 새 캘린더 생성 권장
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-300 leading-relaxed">
                            직원 공용 업무 캘린더나 개인 캘린더를 연동하면 <strong>회의, 연차 등 개인 일정까지 모두 차량 예약으로 동기화</strong>됩니다.
                            반드시 구글 캘린더에서 <strong className="underline">차량 전용 새 캘린더를 생성</strong>하여 연동해 주세요.
                        </p>
                    </div>

                    {/* ── 1단계: 서비스 계정 이메일 공유 ── */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-primary-500 dark:bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
                            <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                                Google 캘린더에 서비스 계정 추가
                            </p>
                        </div>
                        <div className="ml-7 space-y-2">
                            <p className="text-xs text-surface-500 dark:text-surface-400">
                                공유할 캘린더 → <strong className="text-surface-700 dark:text-surface-300">설정 및 공유</strong> →
                                <strong className="text-surface-700 dark:text-surface-300"> 공유 대상 → + 사용자 및 그룹 추가</strong>에서
                                아래 이메일을 <strong className="text-surface-700 dark:text-surface-300">「일정 변경」</strong> 권한으로 추가하세요.
                            </p>
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                                <code className="flex-1 text-[11px] font-mono text-surface-700 dark:text-surface-300 break-all select-all">
                                    {SERVICE_ACCOUNT_EMAIL}
                                </code>
                                <button
                                    type="button"
                                    onClick={handleCopyEmail}
                                    className={`shrink-0 px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                                        emailCopied
                                            ? 'bg-green-500 dark:bg-green-600 text-white'
                                            : 'bg-primary-500 dark:bg-primary-600 hover:bg-primary-600 dark:hover:bg-primary-700 text-white'
                                    }`}
                                >
                                    {emailCopied ? '✓ 복사됨' : '복사'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── 2단계: 캘린더 ID 확인 ── */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-primary-500 dark:bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">2</span>
                            <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                                캘린더 ID 확인
                            </p>
                        </div>
                        <div className="ml-7">
                            <p className="text-xs text-surface-500 dark:text-surface-400">
                                캘린더 설정 →
                                <strong className="text-surface-700 dark:text-surface-300"> 캘린더 통합</strong> 섹션에서
                                캘린더 ID를 복사하여 차량 수정에서 붙여넣기 하세요.
                            </p>
                            {calendarId && (
                                <div className="mt-1.5 p-2 rounded-lg bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                                    <p className="text-[10px] text-surface-400 dark:text-surface-500 mb-0.5">현재 등록된 캘린더 ID:</p>
                                    <code className="text-[11px] font-mono text-surface-600 dark:text-surface-400 break-all">
                                        {calendarId}
                                    </code>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── 3단계: 연동 테스트 ── */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-primary-500 dark:bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">3</span>
                            <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                                연동 테스트로 확인
                            </p>
                        </div>
                        <div className="ml-7">
                            <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
                                설정 완료 후 아래 버튼으로 즉시 연결 상태를 확인하세요.
                            </p>
                            <button
                                type="button"
                                onClick={handleTest}
                                disabled={testLoading || !calendarId}
                                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border-2 border-primary-400 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px]"
                            >
                                {testLoading ? (
                                    <>
                                        <span className="w-4 h-4 spinner" />
                                        테스트 중...
                                    </>
                                ) : (
                                    <>🔄 지금 연동 테스트하기</>
                                )}
                            </button>
                            {!calendarId && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 text-center">
                                    ⚠️ 캘린더 ID가 등록되지 않았습니다. 차량 수정에서 먼저 입력해주세요.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* ── Google Workspace 주의사항 (접기/펼치기) ── */}
                    <details className="text-xs">
                        <summary className="cursor-pointer text-amber-600 dark:text-amber-400 hover:underline font-medium flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                            </svg>
                            Google Workspace(업무 계정) 사용 시 추가 설정 필요
                        </summary>
                        <div className="mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
                            <p className="text-surface-600 dark:text-surface-400">
                                관리 콘솔에서 외부 공유 허용이 필요합니다:
                            </p>
                            <ol className="list-decimal list-inside space-y-1 text-surface-600 dark:text-surface-400 ml-1">
                                <li><strong className="text-surface-700 dark:text-surface-300">Google 관리 콘솔</strong> → 앱 → Google Workspace → Calendar → <strong className="text-surface-700 dark:text-surface-300">일반 설정</strong></li>
                                <li><strong className="text-surface-700 dark:text-surface-300">보조 캘린더의 외부 공유 옵션</strong>에서 <br />
                                    <strong className="text-surface-700 dark:text-surface-300">「모든 정보를 공유하며 외부 사용자도 캘린더를 변경할 수 있음」</strong> 선택</li>
                                <li>오른쪽 하단 <strong className="text-surface-700 dark:text-surface-300">[저장]</strong> 클릭</li>
                            </ol>
                        </div>
                    </details>
                </div>

                {/* ── 하단 액션 ── */}
                <div className="px-6 pb-6 pt-2 flex flex-col sm:flex-row gap-2 border-t border-surface-200 dark:border-surface-700 mt-2">
                    <button
                        type="button"
                        onClick={() => { onClose(); onGoToEdit(vehicle); }}
                        className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                    >
                        ✏️ 차량 수정으로 이동
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors min-h-[48px]"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
