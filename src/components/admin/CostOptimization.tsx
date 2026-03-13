/**
 * CostOptimization — 비용 최적화 분석 + 추천 카드
 * 연료 효율 순위, 정비비, 비정상 탐지, AI 추천
 */
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const PRIORITY_STYLES: Record<string, string> = {
    high: 'border-l-red-500 bg-red-50/50 dark:bg-red-900/10',
    medium: 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-900/10',
    low: 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-900/10',
};

const PRIORITY_LABELS: Record<string, { text: string; color: string }> = {
    high: { text: '높음', color: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30' },
    medium: { text: '보통', color: 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30' },
    low: { text: '낮음', color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30' },
};

const SEVERITY_STYLES: Record<string, string> = {
    high: 'border-l-red-500 bg-red-50/50 dark:bg-red-900/10',
    medium: 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-900/10',
    low: 'border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10',
};

function SectionTitle({ title }: { title: string; icon?: string }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

/* 연료 효율 바 차트 툴팁 */
function FuelTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg p-3 shadow-lg text-sm">
            <p className="font-semibold text-surface-900 dark:text-surface-100 mb-1">{d?.name}</p>
            <p className="text-surface-600 dark:text-surface-400">km당 연료비: <span className="font-mono font-bold text-primary-600">{d?.costPerKm}원</span></p>
            <p className="text-surface-400 text-xs mt-1">총 주행: {d?.totalDist?.toLocaleString()}km · 총 비용: {d?.totalCost?.toLocaleString()}원</p>
        </div>
    );
}

interface FuelItem {
    name: string;
    costPerKm: number;
    totalDist: number;
    totalCost: number;
}

interface MaintenanceCostItem {
    name: string;
    maintenanceCount: number;
    totalMaintenanceCost: number;
    lastMaintenanceDate?: string;
    currentKm?: number;
}

interface Anomaly {
    icon: string;
    title: string;
    desc: string;
    severity: string;
}

interface Recommendation {
    icon: string;
    title: string;
    desc: string;
    priority: string;
}

interface Props {
    fuelEfficiency: { items: FuelItem[]; avgCostPerKm: number };
    maintenanceCostAnalysis: MaintenanceCostItem[];
    anomalies: Anomaly[];
    recommendations: Recommendation[];
}

export default function CostOptimization({
    fuelEfficiency, maintenanceCostAnalysis, anomalies, recommendations,
}: Props) {
    const { items: fuelItems, avgCostPerKm } = fuelEfficiency;

    return (
        <div className="space-y-6">
            {/* 최적화 추천 카드 */}
            {recommendations.length > 0 && (
                <div className="glass-card p-5">
                    <SectionTitle icon="💡" title="최적화 추천" />
                    <div className="space-y-3">
                        {recommendations.map((rec, i) => (
                            <div
                                key={i}
                                className={`border-l-4 rounded-lg p-4 ${PRIORITY_STYLES[rec.priority] || ''}`}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="text-xl flex-shrink-0 mt-0.5">{rec.icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <p className="font-semibold text-surface-900 dark:text-surface-100 text-sm">{rec.title}</p>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_LABELS[rec.priority]?.color || ''}`}>
                                                {PRIORITY_LABELS[rec.priority]?.text || ''}
                                            </span>
                                        </div>
                                        <p className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">{rec.desc}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 연료 효율 순위 */}
            <div className="glass-card p-5">
                <SectionTitle icon="⛽" title="차량별 연료 효율 (km당 비용)" />
                {avgCostPerKm > 0 && (
                    <p className="text-xs text-surface-400 mb-3">
                        전체 평균: <span className="font-mono font-semibold text-primary-600">{avgCostPerKm}원/km</span>
                    </p>
                )}
                {fuelItems.length > 0 ? (
                    <>
                        <ResponsiveContainer width="100%" height={Math.max(180, fuelItems.length * 45)} minWidth={1} minHeight={1}>
                            <BarChart data={fuelItems} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                <XAxis type="number" tick={{ fontSize: 11 }} unit="원" />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11 }} />
                                <Tooltip content={<FuelTooltip />} />
                                <Bar dataKey="costPerKm" name="km당 비용" radius={[0, 6, 6, 0]} barSize={20}>
                                    {fuelItems.map((f, i) => {
                                        const isOver = avgCostPerKm > 0 && f.costPerKm > avgCostPerKm * 1.3;
                                        return <Cell key={i} fill={isOver ? '#ef4444' : '#3b82f6'} />;
                                    })}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        {/* 상세 테이블 */}
                        <div className="mt-4 overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-surface-100 dark:border-surface-700">
                                        <th className="text-left py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">차량명</th>
                                        <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">총 주행거리</th>
                                        <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">총 연료비</th>
                                        <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">km당 비용</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fuelItems.map((f, i) => {
                                        const isOver = avgCostPerKm > 0 && f.costPerKm > avgCostPerKm * 1.3;
                                        return (
                                            <tr key={f.name} className={`border-b border-surface-50 dark:border-surface-800 ${i % 2 === 0 ? 'bg-surface-25 dark:bg-surface-900/50' : ''} hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors`}>
                                                <td className="py-2 px-3 font-medium text-surface-800 dark:text-surface-200">{f.name}</td>
                                                <td className="py-2 px-3 text-right font-mono text-surface-600 dark:text-surface-400">{f.totalDist.toLocaleString()} km</td>
                                                <td className="py-2 px-3 text-right font-mono text-surface-600 dark:text-surface-400">{f.totalCost.toLocaleString()}원</td>
                                                <td className={`py-2 px-3 text-right font-mono font-semibold ${isOver ? 'text-red-600' : 'text-surface-700 dark:text-surface-300'}`}>
                                                    {f.costPerKm}원
                                                    {isOver && <span className="ml-1 text-[10px]">⚠️</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : (
                    <p className="text-surface-400 text-center py-8">연료비 데이터가 없습니다</p>
                )}
            </div>

            {/* 정비비 분석 */}
            <div className="glass-card p-5">
                <SectionTitle icon="🔧" title="차량별 정비 비용" />
                {maintenanceCostAnalysis.filter(v => v.maintenanceCount > 0).length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-surface-100 dark:border-surface-700">
                                    <th className="text-left py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">차량명</th>
                                    <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">정비 횟수</th>
                                    <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">총 정비비</th>
                                    <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">마지막 정비</th>
                                    <th className="text-right py-2 px-3 font-semibold text-surface-600 dark:text-surface-400">현재 주행거리</th>
                                </tr>
                            </thead>
                            <tbody>
                                {maintenanceCostAnalysis.filter(v => v.maintenanceCount > 0).map((v, i) => (
                                    <tr key={v.name} className={`border-b border-surface-50 dark:border-surface-800 ${i % 2 === 0 ? 'bg-surface-25 dark:bg-surface-900/50' : ''} hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors`}>
                                        <td className="py-2 px-3 font-medium text-surface-800 dark:text-surface-200">{v.name}</td>
                                        <td className="py-2 px-3 text-right text-surface-600 dark:text-surface-400">{v.maintenanceCount}건</td>
                                        <td className="py-2 px-3 text-right font-mono text-surface-700 dark:text-surface-300">{v.totalMaintenanceCost.toLocaleString()}원</td>
                                        <td className="py-2 px-3 text-right text-surface-500 dark:text-surface-400 text-xs">{v.lastMaintenanceDate || '-'}</td>
                                        <td className="py-2 px-3 text-right font-mono text-surface-500 dark:text-surface-400">{v.currentKm?.toLocaleString() || '-'} km</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-surface-400 text-center py-8">정비 기록이 없습니다</p>
                )}
            </div>

            {/* 비정상 운행 알림 */}
            {anomalies.length > 0 && (
                <div className="glass-card p-5">
                    <SectionTitle icon="⚠️" title="비정상 운행 감지" />
                    <div className="space-y-3">
                        {anomalies.map((a, i) => (
                            <div
                                key={i}
                                className={`border-l-4 rounded-lg p-4 ${SEVERITY_STYLES[a.severity] || ''}`}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="text-xl flex-shrink-0">{a.icon}</span>
                                    <div>
                                        <p className="font-semibold text-surface-900 dark:text-surface-100 text-sm">{a.title}</p>
                                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 leading-relaxed">{a.desc}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 추천이 없을 때 */}
            {recommendations.length === 0 && anomalies.length === 0 && (
                <div className="glass-card p-8 text-center">
                    <div className="text-4xl mb-3">✅</div>
                    <p className="text-surface-600 dark:text-surface-400 font-medium">모든 지표가 양호합니다</p>
                    <p className="text-surface-400 text-sm mt-1">특별한 최적화 추천 사항이 없습니다.</p>
                </div>
            )}
        </div>
    );
}
