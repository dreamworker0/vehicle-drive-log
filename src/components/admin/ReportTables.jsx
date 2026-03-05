/**
 * ReportTables — 통계 보고서 상세 테이블 탭 (MonthlyReport에서 분리)
 */

function SectionTitle({ title }) {
    return (
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
            {title}
        </h2>
    );
}

export default function ReportTables({ driverData, vehicleData, stats }) {
    return (
        <div className="space-y-6">
            {/* 직원별 상세 */}
            <div className="glass-card p-5">
                <SectionTitle icon="👤" title="직원별 상세" />
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-surface-100 dark:border-surface-700">
                                <th className="text-left py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">직원명</th>
                                <th className="text-right py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">운행 횟수</th>
                                <th className="text-right py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">총 주행거리</th>
                                <th className="text-right py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">평균 주행거리</th>
                            </tr>
                        </thead>
                        <tbody>
                            {driverData.map((d, i) => (
                                <tr key={d.name} className={`border-b border-surface-50 ${i % 2 === 0 ? 'bg-surface-25' : ''} hover:bg-primary-50/30 transition-colors`}>
                                    <td className="py-2.5 px-3 font-medium text-surface-800 dark:text-surface-200">{d.name}</td>
                                    <td className="py-2.5 px-3 text-right text-surface-600 dark:text-surface-400">{d.count}건</td>
                                    <td className="py-2.5 px-3 text-right font-mono text-surface-700 dark:text-surface-300">{d.distance.toLocaleString()} km</td>
                                    <td className="py-2.5 px-3 text-right font-mono text-surface-500 dark:text-surface-400">{d.avgDistance.toLocaleString()} km</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-surface-200 dark:border-surface-600 font-semibold bg-surface-50 dark:bg-surface-800">
                                <td className="py-2.5 px-3 text-surface-800 dark:text-surface-200">합계</td>
                                <td className="py-2.5 px-3 text-right text-surface-800 dark:text-surface-200">{stats.totalRuns}건</td>
                                <td className="py-2.5 px-3 text-right font-mono text-surface-800 dark:text-surface-200">{stats.totalDistance.toLocaleString()} km</td>
                                <td className="py-2.5 px-3 text-right font-mono text-surface-500 dark:text-surface-400">{stats.avgDistance.toLocaleString()} km</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* 차량별 상세 */}
            <div className="glass-card p-5">
                <SectionTitle icon="🚗" title="차량별 상세" />
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-surface-100 dark:border-surface-700">
                                <th className="text-left py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">차량명</th>
                                <th className="text-right py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">운행 횟수</th>
                                <th className="text-right py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">총 주행거리</th>
                                <th className="text-right py-3 px-3 font-semibold text-surface-600 dark:text-surface-400">주유/충전비</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vehicleData.map((v, i) => (
                                <tr key={v.name} className={`border-b border-surface-50 ${i % 2 === 0 ? 'bg-surface-25' : ''} hover:bg-primary-50/30 transition-colors`}>
                                    <td className="py-2.5 px-3 font-medium text-surface-800 dark:text-surface-200">{v.name}</td>
                                    <td className="py-2.5 px-3 text-right text-surface-600 dark:text-surface-400">{v.count}건</td>
                                    <td className="py-2.5 px-3 text-right font-mono text-surface-700 dark:text-surface-300">{v.distance.toLocaleString()} km</td>
                                    <td className="py-2.5 px-3 text-right font-mono text-surface-500 dark:text-surface-400">{v.fuel > 0 ? `${v.fuel.toLocaleString()}원` : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-surface-200 dark:border-surface-600 font-semibold bg-surface-50 dark:bg-surface-800">
                                <td className="py-2.5 px-3 text-surface-800 dark:text-surface-200">합계</td>
                                <td className="py-2.5 px-3 text-right text-surface-800 dark:text-surface-200">{stats.totalRuns}건</td>
                                <td className="py-2.5 px-3 text-right font-mono text-surface-800 dark:text-surface-200">{stats.totalDistance.toLocaleString()} km</td>
                                <td className="py-2.5 px-3 text-right font-mono text-surface-800 dark:text-surface-200">{stats.totalFuel > 0 ? `${stats.totalFuel.toLocaleString()}원` : '-'}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}
