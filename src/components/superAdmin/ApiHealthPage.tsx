import DashboardApiHealth from './dashboard/DashboardApiHealth';

export default function ApiHealthPage() {
    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 shrink-0">
                    헬스 체크 모니터링
                </h1>
            </div>
            
            <div className="bg-surface-50 dark:bg-surface-900/50 p-6 rounded-2xl border border-surface-100 dark:border-surface-700 shadow-sm">
                <DashboardApiHealth />
            </div>
        </div>
    );
}
