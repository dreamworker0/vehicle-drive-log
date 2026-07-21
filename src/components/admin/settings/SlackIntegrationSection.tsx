/**
 * SlackIntegrationSection — 설정의 "Slack 연결" 카드 (기관 셀프서비스)
 *
 * 미연결: 예시 대화 + 연결 전 확인 3가지(이메일 일치 요건 강조) + [Slack에 연결하기]
 * 연결됨: 워크스페이스 정보 + 직원 준비 상태(이메일 매칭 진단) + [연결 테스트][연결 해제]
 * 로직은 useSlackIntegration 훅에 위임. 토큰 값은 프론트에 오지 않는다.
 */
import { useState } from 'react';
import { useSlackIntegration } from '../../../hooks/useSlackIntegration';

/** Slack 공식 4색 로고 */
function SlackMark({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 122 122" aria-hidden="true">
            <path fill="#36C5F0" d="M25.8 77c0 7-5.7 12.8-12.8 12.8S.2 84 .2 77s5.7-12.8 12.8-12.8h12.8V77zM32.3 77c0-7 5.7-12.8 12.8-12.8S57.9 70 57.9 77v32.1c0 7-5.7 12.8-12.8 12.8s-12.8-5.7-12.8-12.8V77z" />
            <path fill="#2EB67D" d="M45.1 25.6c-7 0-12.8-5.7-12.8-12.8S38 0 45.1 0s12.8 5.7 12.8 12.8v12.8H45.1zM45.1 32.1c7 0 12.8 5.7 12.8 12.8s-5.7 12.8-12.8 12.8H12.9C5.9 57.7.2 52 .2 44.9s5.7-12.8 12.8-12.8h32.1z" />
            <path fill="#ECB22E" d="M96.4 44.9c0-7 5.7-12.8 12.8-12.8s12.8 5.7 12.8 12.8-5.7 12.8-12.8 12.8H96.4V44.9zM89.9 44.9c0 7-5.7 12.8-12.8 12.8s-12.8-5.7-12.8-12.8V12.8C64.3 5.8 70 .1 77.1.1s12.8 5.7 12.8 12.8v32z" />
            <path fill="#E01E5A" d="M77.1 96.3c7 0 12.8 5.7 12.8 12.8s-5.7 12.8-12.8 12.8-12.8-5.7-12.8-12.8V96.3h12.8zM77.1 89.8c-7 0-12.8-5.7-12.8-12.8s5.7-12.8 12.8-12.8h32.1c7 0 12.8 5.7 12.8 12.8s-5.7 12.8-12.8 12.8H77.1z" />
        </svg>
    );
}

/** 연결 전 확인 항목 한 줄 */
function CheckItem({ warn, title, hint }: { warn?: boolean; title: string; hint?: string }) {
    return (
        <div className={`flex gap-2.5 px-3.5 py-2.5 rounded-xl border ${warn
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50'
            : 'bg-surface-50 dark:bg-surface-800 border-surface-100 dark:border-surface-700'}`}
        >
            <span className="flex-shrink-0 text-sm leading-5">{warn ? '⚠️' : '✅'}</span>
            <div className="text-sm">
                <p className="font-medium text-surface-800 dark:text-surface-200">{title}</p>
                {hint && <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{hint}</p>}
            </div>
        </div>
    );
}

export default function SlackIntegrationSection() {
    const { status, staff, connecting, diagnosing, disconnecting, connect, disconnect, diagnose } = useSlackIntegration();
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

    const matchedCount = staff?.filter((s) => s.matched).length ?? 0;

    return (
        <div className="glass-card p-6 mb-6">
            {/* 헤더: 제목 + 상태 배지 */}
            <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-surface-900 dark:text-surface-100">
                    <SlackMark className="w-5 h-5 flex-shrink-0" />
                    {status?.connected ? 'Slack 연결' : 'Slack으로 차량 예약하기'}
                </h2>
                {status === null ? (
                    <div className="w-4 h-4 spinner flex-shrink-0 mt-1" />
                ) : status.connected ? (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full flex-shrink-0">● 연결됨</span>
                ) : (
                    <span className="text-xs font-medium text-surface-500 dark:text-surface-400 bg-surface-100 dark:bg-surface-800 px-2.5 py-1 rounded-full flex-shrink-0">미연결</span>
                )}
            </div>

            {status === null ? (
                <div className="flex justify-center py-8"><div className="w-6 h-6 spinner" /></div>
            ) : !status.connected ? (
                <>
                    <p className="text-xs text-surface-400 mb-4">직원이 Slack에서 말을 걸면 차량을 예약·조회할 수 있어요. 이렇게요:</p>

                    {/* 예시 대화 */}
                    <div className="flex flex-col gap-2 mb-5">
                        <div className="self-end max-w-[82%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-primary-600 text-white text-sm">
                            <span className="block text-[11px] font-semibold opacity-70 mb-0.5">김영희</span>
                            내일 오전 10시부터 12시까지 스타렉스 예약해줘
                        </div>
                        <div className="self-start max-w-[82%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700 text-sm text-surface-800 dark:text-surface-200">
                            <span className="block text-[11px] font-semibold text-surface-400 mb-0.5">차량운행일지봇</span>
                            스타렉스 · 내일 10:00~12:00 로 예약할까요?
                            <span className="flex gap-1.5 mt-2">
                                <span className="text-xs font-semibold px-3 py-1 rounded-lg bg-emerald-600 text-white">예약 확정</span>
                                <span className="text-xs font-semibold px-3 py-1 rounded-lg border border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400">취소</span>
                            </span>
                        </div>
                    </div>

                    {/* 연결 전 확인 */}
                    <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">연결 전 확인 (3가지)</p>
                    <div className="space-y-2 mb-5">
                        <CheckItem title="우리 기관 Slack 워크스페이스가 있다" />
                        <CheckItem title="나는 Slack 워크스페이스 관리자다" hint="아니라면 Slack 워크스페이스 관리자가 대신 승인해야 합니다." />
                        <CheckItem warn title="직원의 Slack 이메일 = 차량운행일지 가입 이메일" hint="이메일이 다르면 봇이 예약자를 알아보지 못합니다. 연결 후 '직원 준비 상태'에서 자동으로 점검해 드립니다." />
                    </div>

                    <button
                        onClick={() => void connect()}
                        disabled={connecting}
                        className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-white text-[#1d1c1d] border border-surface-300 dark:border-surface-500 font-semibold text-sm hover:bg-surface-50 transition-colors disabled:opacity-60"
                    >
                        {connecting ? <div className="w-4 h-4 spinner" /> : <SlackMark className="w-4.5 h-4.5 w-[18px] h-[18px]" />}
                        {connecting ? 'Slack으로 이동 중...' : 'Slack에 연결하기'}
                    </button>
                    <p className="text-xs text-surface-400 mt-2.5">버튼을 누르면 Slack 인증 화면으로 이동합니다. 토큰이나 코드를 직접 입력할 필요는 없습니다.</p>
                </>
            ) : (
                <>
                    {/* 워크스페이스 정보 */}
                    <div className="flex items-center gap-3 p-3.5 mt-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700">
                        <div className="w-10 h-10 rounded-lg bg-[#611f69] text-white flex items-center justify-center font-bold flex-shrink-0">
                            {(status.teamName || 'S').charAt(0)}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{status.teamName || 'Slack 워크스페이스'}</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400">
                                {status.connectedAt ? `${new Date(status.connectedAt).toLocaleDateString('ko-KR')} 연결` : '연결됨'} · 봇 @차량운행일지봇
                            </p>
                        </div>
                    </div>

                    {/* 직원 준비 상태 */}
                    <div className="mt-5">
                        <div className="flex items-baseline justify-between mb-2">
                            <p className="text-sm font-semibold text-surface-800 dark:text-surface-200">직원 준비 상태</p>
                            {staff && (
                                <span className="text-xs text-surface-500 dark:text-surface-400 tabular-nums">
                                    {staff.length}명 중 {matchedCount}명 준비됨
                                </span>
                            )}
                        </div>
                        {diagnosing && !staff ? (
                            <div className="flex justify-center py-4"><div className="w-5 h-5 spinner" /></div>
                        ) : staff ? (
                            <>
                                <div className="space-y-1.5">
                                    {staff.map((s) => (
                                        <div
                                            key={s.email}
                                            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${s.matched
                                                ? 'bg-emerald-50 dark:bg-emerald-900/20'
                                                : 'bg-amber-50 dark:bg-amber-900/20'}`}
                                        >
                                            <span className="flex-shrink-0 text-xs">{s.matched ? '✅' : '⚠️'}</span>
                                            <span className="font-medium text-surface-800 dark:text-surface-200">{s.name}</span>
                                            <span className={`ml-auto text-xs truncate ${s.matched ? 'text-surface-500 dark:text-surface-400' : 'text-amber-600 dark:text-amber-400 font-medium'}`}>
                                                {s.matched ? s.email : 'Slack 이메일 불일치'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                {staff.some((s) => !s.matched) && (
                                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-2.5 pl-1 leading-relaxed">
                                        ↳ 표시된 직원은 <strong className="text-surface-700 dark:text-surface-300">Slack 계정 설정(내 계정 관리)</strong>에서 이메일을 <strong className="text-surface-700 dark:text-surface-300">앱 가입 이메일과 동일하게</strong> 바꾸면 자동으로 인식됩니다. 회사 Slack이 Google·SSO로 관리돼 이메일 변경이 안 되면, 반대로 <strong className="text-surface-700 dark:text-surface-300">앱 가입 이메일</strong>을 Slack 이메일과 맞추셔도 됩니다.
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="text-xs text-surface-400 py-2">진단 정보를 불러오지 못했습니다. 아래 '연결 테스트'를 눌러 다시 시도해주세요.</p>
                        )}
                    </div>

                    {/* 직원 사용법 */}
                    <div className="mt-5 p-3.5 rounded-xl border border-dashed border-surface-200 dark:border-surface-600 text-xs text-surface-500 dark:text-surface-400">
                        <strong className="text-surface-700 dark:text-surface-300">직원 사용법</strong> — Slack에서 <code className="px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-[11px]">차량운행일지봇</code>을 검색해 DM으로 "오늘 예약 현황", "내일 스타렉스 예약"처럼 말하면 됩니다.
                    </div>

                    {/* 액션 */}
                    <div className="flex gap-2.5 mt-5">
                        <button
                            onClick={() => void diagnose()}
                            disabled={diagnosing}
                            className="btn-secondary flex items-center gap-2"
                        >
                            {diagnosing && <div className="w-3.5 h-3.5 spinner" />}
                            연결 테스트
                        </button>
                        {confirmingDisconnect ? (
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs text-surface-500 dark:text-surface-400">해제하면 봇이 응답하지 않습니다.</span>
                                <button
                                    onClick={() => { setConfirmingDisconnect(false); void disconnect(); }}
                                    disabled={disconnecting}
                                    className="btn-danger text-sm"
                                >
                                    {disconnecting ? '해제 중...' : '해제 확인'}
                                </button>
                                <button onClick={() => setConfirmingDisconnect(false)} className="btn-secondary text-sm">취소</button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmingDisconnect(true)}
                                disabled={disconnecting}
                                className="ml-auto text-sm font-medium text-red-500 dark:text-red-400 px-4 py-2 rounded-xl border border-surface-200 dark:border-surface-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                                연결 해제
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
