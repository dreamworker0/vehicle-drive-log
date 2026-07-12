/**
 * VehicleCalendarSection — 차량 폼 내 Google Calendar 연동 UI 섹션
 * VehicleForm에서 분리된 서브 컴포넌트
 */
import React, { useRef, useEffect, useState } from 'react';
import type { Vehicle } from '../../types';
import { firebaseFunctions } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';

interface CalTestResult {
    success: boolean;
    message: string;
    errorType?: string;
    errorTitle?: string;
}

interface Props {
    calendarId: string;
    onChange: (value: string) => void;
    editingVehicle: Vehicle | null;
    onCalendarTestResult?: (vehicleId: string, success: boolean) => Promise<void>;
    initialCalendarError?: boolean;
}

const SERVICE_ACCOUNT_EMAIL = '1066541065552-compute@developer.gserviceaccount.com';

export default function VehicleCalendarSection({
    calendarId,
    onChange,
    editingVehicle,
    onCalendarTestResult,
    initialCalendarError,
}: Props) {
    const calendarInputRef = useRef<HTMLInputElement>(null);
    const [calTestLoading, setCalTestLoading] = useState(false);
    const [calTestResult, setCalTestResult] = useState<CalTestResult | null>(null);

    const calSyncFailCount = editingVehicle?.calendarSyncFailCount || 0;
    const hasCalSyncError = calSyncFailCount >= 3;

    const handleCalendarTest = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const calId = calendarId.trim();
        if (!calId) return;
        setCalTestLoading(true);
        setCalTestResult(null);
        try {
            const fn = httpsCallable(firebaseFunctions, 'testCalendarAccess');
            const res = await fn({ calendarId: calId });
            const result = res.data as CalTestResult;
            setCalTestResult(result);
            if (editingVehicle && onCalendarTestResult) {
                await onCalendarTestResult(editingVehicle.id, result?.success ?? false);
            }
        } catch {
            const errResult: CalTestResult = {
                success: false,
                message: '테스트 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            };
            setCalTestResult(errResult);
            if (editingVehicle && onCalendarTestResult) {
                await onCalendarTestResult(editingVehicle.id, false);
            }
        } finally {
            setCalTestLoading(false);
        }
    };

    // initialCalendarError=true: 에러 상태로 초기화 + 캘린더 ID 입력란 포커스
    useEffect(() => {
        if (!initialCalendarError) return;
        setCalTestResult({
            success: false,
            errorTitle: '캘린더를 찾을 수 없음',
            message:
                '입력한 캘린더 ID가 올바르지 않거나 삭제된 캘린더입니다. 캘린더 설정 → 캘린더 통합에서 캘린더 ID를 다시 확인해주세요.',
        });
        const timer = setTimeout(() => {
            calendarInputRef.current?.focus();
            calendarInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
        return () => clearTimeout(timer);
    }, [initialCalendarError]);

    const handleCopyEmail = (e: React.MouseEvent<HTMLButtonElement>) => {
        navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
        const btn = e.currentTarget;
        btn.textContent = '✓ 복사됨';
        setTimeout(() => {
            btn.textContent = '복사';
        }, 1500);
    };

    return (
        <div>
            <label className="label">Google 캘린더 ID (선택)</label>
            <div className="flex gap-2">
                <input
                    ref={calendarInputRef}
                    type="text"
                    value={calendarId}
                    onChange={e => {
                        onChange(e.target.value);
                        setCalTestResult(null);
                    }}
                    className="input flex-1"
                    placeholder="calendar-resource-id@resource.calendar.google.com"
                />
                {calendarId.trim() && (
                    <button
                        type="button"
                        onClick={handleCalendarTest}
                        disabled={calTestLoading}
                        className="shrink-0 px-3 py-2 rounded-xl text-xs font-medium border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors disabled:opacity-50 min-h-[48px]"
                    >
                        {calTestLoading ? (
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 spinner" />
                                테스트 중
                            </span>
                        ) : (
                            '🔄 연동 테스트'
                        )}
                    </button>
                )}
            </div>

            {/* 연동 테스트 결과 */}
            {calTestResult && (
                <div
                    className={`mt-2 p-3 rounded-lg text-xs border ${
                        calTestResult.success
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                    }`}
                >
                    <p className="font-medium">
                        {calTestResult.success ? '✅ ' : '❌ '}
                        {calTestResult.errorTitle || (calTestResult.success ? '연동 정상' : '연동 실패')}
                    </p>
                    <p className="mt-1 text-surface-600 dark:text-surface-400">{calTestResult.message}</p>
                </div>
            )}

            {/* 수정 모드: 동기화 실패 알림 */}
            {editingVehicle && calendarId.trim() && !calTestResult && hasCalSyncError && (
                <div className="mt-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs">
                    <p className="font-medium text-red-700 dark:text-red-400">
                        ⚠️ 이 차량의 캘린더 동기화가 실패하고 있습니다 (실패 {calSyncFailCount}회)
                    </p>
                    <p className="mt-1 text-surface-600 dark:text-surface-400">
                        아래 설정 방법을 따라 서비스 계정에 캘린더 공유를 추가한 뒤, "🔄 연동 테스트" 버튼으로 확인해주세요.
                    </p>
                </div>
            )}

            {/* 수정 모드: 정상 동기화 확인 */}
            {editingVehicle && calendarId.trim() && !calTestResult && !hasCalSyncError && calSyncFailCount === 0 && (
                <p className="mt-1.5 text-xs text-green-600 dark:text-green-400">✅ 정상 동기화 중</p>
            )}

            {/* 설정 방법 안내 */}
            <details
                className="mt-2 text-xs text-surface-500 dark:text-surface-400"
                open={hasCalSyncError || (calTestResult != null && !calTestResult.success)}
            >
                <summary className="cursor-pointer text-primary-600 dark:text-primary-400 hover:underline font-medium">
                    📋 설정 방법 안내
                </summary>
                <div className="mt-2 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 space-y-2 border border-surface-200 dark:border-surface-700">
                    
                    {/* 새 캘린더 생성 주의사항 추가 */}
                    <div className="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                        <p className="font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
                            <span className="text-sm">⚠️</span> 주의사항: 새 캘린더 생성 권장
                        </p>
                        <p className="mt-1 text-red-600 dark:text-red-300">
                            직원 공용 업무 캘린더나 개인 캘린더를 연동하면 <strong>회의, 연차 등 개인 일정까지 모두 차량 예약으로 동기화</strong>됩니다.
                            반드시 구글 캘린더에서 <strong className="underline">차량 전용 새 캘린더를 생성</strong>하여 연동해 주세요.
                        </p>
                    </div>

                    <p className="font-medium text-surface-700 dark:text-surface-300">구글 캘린더 동기화 설정 방법:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-surface-600 dark:text-surface-400">
                        <li>
                            구글 캘린더에서 공유할 캘린더의{' '}
                            <strong className="text-surface-700 dark:text-surface-300">설정 및 공유</strong>로 이동
                        </li>
                        <li>
                            <strong className="text-surface-700 dark:text-surface-300">공유 대상</strong>에서{' '}
                            <strong className="text-surface-700 dark:text-surface-300">+ 사용자 및 그룹 추가</strong>를 클릭하고,
                            아래 이메일을{' '}
                            <strong className="text-surface-700 dark:text-surface-300">"일정 변경"</strong> 권한으로 추가
                        </li>
                        <li>
                            <strong className="text-surface-700 dark:text-surface-300">캘린더 통합</strong> 섹션에서 캘린더 ID를
                            복사하여 위 입력란에 붙여넣기
                        </li>
                        <li>
                            위{' '}
                            <strong className="text-surface-700 dark:text-surface-300">"🔄 연동 테스트"</strong> 버튼을 눌러 정상
                            연결을 확인
                        </li>
                    </ol>

                    {/* 캘린더 직접 등록 시 권장 제목 형식 안내 */}
                    <div className="mt-3 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <p className="font-medium text-blue-700 dark:text-blue-400 mb-1.5">
                            💡 구글 캘린더에서 직접 일정을 등록할 때
                        </p>
                        <p className="text-surface-600 dark:text-surface-400">
                            제목을{' '}
                            <strong className="text-surface-700 dark:text-surface-300">목적지 — 예약자</strong>{' '}
                            형식(예: <code className="px-1 rounded bg-surface-100 dark:bg-surface-700">서울역 — 김직원</code>)으로
                            작성하면 예약자와 목적지가 정확히 반영됩니다. 일정 설명란에{' '}
                            <code className="px-1 rounded bg-surface-100 dark:bg-surface-700">예약자:</code>{' '}
                            <code className="px-1 rounded bg-surface-100 dark:bg-surface-700">용도:</code>{' '}
                            <code className="px-1 rounded bg-surface-100 dark:bg-surface-700">목적지:</code>{' '}
                            줄을 넣어도 됩니다. 목적지만 적으면(예:{' '}
                            <code className="px-1 rounded bg-surface-100 dark:bg-surface-700">합정역</code>) 예약자는 일정
                            작성자 계정으로 자동 추정됩니다.
                        </p>
                    </div>
                    <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1.5">
                            ⚠️ Google Workspace(업무 계정) 사용 시
                        </p>
                        <p className="text-surface-600 dark:text-surface-400 mb-1">
                            관리 콘솔에서 캘린더 외부 공유를 허용해야 합니다:
                        </p>
                        <ol className="list-decimal list-inside space-y-1 text-surface-600 dark:text-surface-400 ml-1">
                            <li>
                                <strong className="text-surface-700 dark:text-surface-300">Google 관리 콘솔</strong> → 앱 → Google
                                Workspace → Calendar 설정 →{' '}
                                <strong className="text-surface-700 dark:text-surface-300">일반 설정</strong>
                            </li>
                            <li>
                                <strong className="text-surface-700 dark:text-surface-300">보조 캘린더의 외부 공유 옵션</strong>에서{' '}
                                <strong className="text-surface-700 dark:text-surface-300">
                                    "모든 정보를 공유하며 외부 사용자도 캘린더를 변경할 수 있음"
                                </strong>{' '}
                                선택
                            </li>
                            <li>
                                오른쪽 하단의{' '}
                                <strong className="text-surface-700 dark:text-surface-300">[저장]</strong> 클릭
                            </li>
                        </ol>
                    </div>
                    <div className="mt-2">
                        <p className="text-[11px] text-surface-500 dark:text-surface-400 mb-1.5">
                            공유 대상에 추가할 서비스 계정 이메일:
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 px-2 py-1.5 rounded bg-surface-100 dark:bg-surface-900 text-[11px] font-mono text-surface-700 dark:text-surface-300 select-all break-all">
                                {SERVICE_ACCOUNT_EMAIL}
                            </code>
                            <button
                                type="button"
                                onClick={handleCopyEmail}
                                className="shrink-0 px-2.5 py-1.5 text-[11px] rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors min-h-[48px]"
                            >
                                복사
                            </button>
                        </div>
                    </div>
                    <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
                        💡 기관 내 모든 차량에 같은 캘린더 ID를 사용하면 통합 관리가 편리합니다
                    </p>
                </div>
            </details>
        </div>
    );
}
