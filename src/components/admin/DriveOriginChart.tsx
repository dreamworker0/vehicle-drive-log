/**
 * DriveOriginChart — 월별 운행 방식 (사전 예약 · 바로 운행 · 예약 없이 기록)
 *
 * 운행이 어떻게 시작됐는지를 월별 누적 막대로 보여 준다. 바로 운행 비중이 높은 기관은
 * 차량이 겹칠 위험을 살피는 근거가 되고, 사전 예약 비중은 예약 문화가 자리 잡았는지를 보여 준다.
 *
 * 색은 dataviz 기본 팔레트의 blue · aqua · yellow(라이트/다크 각각 검증)다. 라이트 모드에서
 * aqua·yellow가 배경 대비 3:1에 못 미쳐 위쪽 요약 줄에 비율을 글자로 함께 적는다.
 * '구분 전'은 driveOrigin이 저장되기 전(2026-10 이전) 일지 중 예약에 연결된 것으로, 의미상
 * "알 수 없음"이라 중립 회색으로 둔다.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useThemeStore } from '../../store/useThemeStore';

export interface DriveOriginPoint {
    label: string;
    reservation: number;
    quick: number;
    manual: number;
    linked: number;
}

type SeriesKey = 'reservation' | 'quick' | 'manual' | 'linked';

const SERIES: { key: SeriesKey; name: string; light: string; dark: string }[] = [
    { key: 'reservation', name: '사전 예약', light: '#2a78d6', dark: '#3987e5' },
    { key: 'quick', name: '바로 운행', light: '#1baf7a', dark: '#199e70' },
    { key: 'manual', name: '예약 없이 기록', light: '#eda100', dark: '#c98500' },
    { key: 'linked', name: '예약 연결 (구분 전)', light: '#94a3b8', dark: '#64748b' },
];

interface TooltipEntry { dataKey?: string; value?: number; color?: string; name?: string }

function OriginTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const total = payload.reduce((s, p) => s + (p.value || 0), 0);
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{label} · {total.toLocaleString()}건</p>
            {[...payload].reverse().filter(p => (p.value || 0) > 0).map(p => (
                <p key={p.dataKey} className="flex items-center gap-1.5 text-surface-600 dark:text-surface-300">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
                    {p.name}: <span className="font-mono font-medium text-surface-900 dark:text-surface-100">{(p.value || 0).toLocaleString()}건</span>
                    <span className="text-surface-400 dark:text-surface-500">({total > 0 ? Math.round(((p.value || 0) / total) * 100) : 0}%)</span>
                </p>
            ))}
        </div>
    );
}

export default function DriveOriginChart({ data }: { data: DriveOriginPoint[] }) {
    const isDark = useThemeStore(s => s.theme === 'dark');
    const surface = isDark ? '#1e293b' : '#ffffff';

    const totals = SERIES.map(s => ({ ...s, value: data.reduce((sum, d) => sum + d[s.key], 0) }));
    const grand = totals.reduce((s, t) => s + t.value, 0);

    return (
        <div className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-1">운행 방식</h2>
            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                운행을 미리 예약하고 했는지, 예약 없이 바로 출발했는지, 예약 없이 일지만 적었는지
            </p>
            {grand === 0 ? (
                <p className="text-surface-400 text-center py-8">데이터가 없습니다</p>
            ) : (
                <>
                    {/* 기간 합계 — 범례를 겸한다. 막대 색만으로 읽히지 않게 비율을 글자로 함께 적는다 */}
                    <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4">
                        {totals.filter(t => t.value > 0).map(t => (
                            <div key={t.key} className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: isDark ? t.dark : t.light }} aria-hidden="true" />
                                <span className="text-sm text-surface-600 dark:text-surface-300">{t.name}</span>
                                <span className="text-sm font-bold text-surface-900 dark:text-surface-100">{Math.round((t.value / grand) * 100)}%</span>
                                <span className="text-xs text-surface-400 dark:text-surface-500">{t.value.toLocaleString()}건</span>
                            </div>
                        ))}
                    </div>
                    <ResponsiveContainer width="100%" height={260} minWidth={1} minHeight={1}>
                        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <Tooltip content={<OriginTooltip />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)' }} />
                            {SERIES.map((s, i) => (
                                <Bar
                                    key={s.key}
                                    dataKey={s.key}
                                    name={s.name}
                                    stackId="origin"
                                    fill={isDark ? s.dark : s.light}
                                    // 겹친 조각 사이에 배경색 2px 틈을 둔다
                                    stroke={surface}
                                    strokeWidth={2}
                                    radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                                    maxBarSize={48}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                    {totals.find(t => t.key === 'linked')!.value > 0 && (
                        <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-2">
                            ⓘ '예약 연결 (구분 전)'은 2026년 10월 이전에 쓴 일지 중 예약과 연결된 것이에요. 그때는 바로 운행 여부를 따로 저장하지 않아 사전 예약과 구분할 수 없어요.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
