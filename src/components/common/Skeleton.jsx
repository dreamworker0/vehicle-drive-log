export function SkeletonBox({ className = '' }) {
    return (
        <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
    );
}

export function SkeletonCard() {
    return (
        <div className="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-surface-700">
            <div className="flex items-center gap-3 mb-3">
                <SkeletonBox className="w-10 h-10 rounded-full" />
                <div className="flex-1">
                    <SkeletonBox className="h-4 w-3/4 mb-2" />
                    <SkeletonBox className="h-3 w-1/2" />
                </div>
            </div>
            <SkeletonBox className="h-3 w-full mb-2" />
            <SkeletonBox className="h-3 w-2/3" />
        </div>
    );
}

export function SkeletonStatCard() {
    return (
        <div className="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-surface-700">
            <SkeletonBox className="h-3 w-1/2 mb-3" />
            <SkeletonBox className="h-8 w-1/3 mb-2" />
            <SkeletonBox className="h-3 w-2/3" />
        </div>
    );
}

export function SkeletonList({ count = 4 }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-surface-700 flex items-center gap-3">
                    <SkeletonBox className="w-8 h-8 rounded-lg" />
                    <div className="flex-1">
                        <SkeletonBox className="h-4 w-2/5 mb-2" />
                        <SkeletonBox className="h-3 w-3/5" />
                    </div>
                    <SkeletonBox className="w-16 h-8 rounded-lg" />
                </div>
            ))}
        </div>
    );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
    return (
        <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-gray-100 dark:border-surface-700 overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-surface-700">
                <SkeletonBox className="h-4 w-1/4" />
            </div>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex gap-4 p-4 border-b border-gray-50">
                    {Array.from({ length: cols }).map((_, j) => (
                        <SkeletonBox key={j} className="h-4 flex-1" />
                    ))}
                </div>
            ))}
        </div>
    );
}
