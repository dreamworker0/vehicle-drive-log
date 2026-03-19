/**
 * LogManager — 관리자용 일지 통합 관리 페이지
 * 운행일지, 일별일지, 주유일지, 하이패스일지를 탭으로 전환
 */
import { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { lazyWithRetry } from '../../lib/lazyWithRetry';

const DriveLogList = lazyWithRetry(() => import('./DriveLogList'));
const FuelLogManager = lazyWithRetry(() => import('./FuelLogManager'));
const DailyLogView = lazyWithRetry(() => import('./DailyLogView'));
const HipassChargeLogManager = lazyWithRetry(() => import('./HipassChargeLogManager'));

type TabKey = 'drive' | 'daily' | 'fuel' | 'hipass';

interface Tab {
    key: TabKey;
    label: string;
    icon: React.ReactNode;
}

const tabs: Tab[] = [
    {
        key: 'drive',
        label: '운행일지',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
            </svg>
        ),
    },
    {
        key: 'daily',
        label: '일별일지',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
        ),
    },
    {
        key: 'fuel',
        label: '주유일지',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11.25V4.875A2.625 2.625 0 0 0 12.375 2.25h-4.75A2.625 2.625 0 0 0 5 4.875V18.75a2.25 2.25 0 0 0 2.25 2.25h5.5A2.25 2.25 0 0 0 15 18.75v-3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 8.25h1.5a2.25 2.25 0 0 1 2.25 2.25v3a1.5 1.5 0 0 0 3 0V7.5l-2.25-3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 9h9.5" />
            </svg>
        ),
    },
    {
        key: 'hipass',
        label: '하이패스일지',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
            </svg>
        ),
    },
];

const VALID_TABS = new Set<string>(tabs.map(t => t.key));

export default function LogManager() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const activeTab: TabKey = rawTab && VALID_TABS.has(rawTab) ? (rawTab as TabKey) : 'drive';

    const handleTabChange = (key: TabKey) => {
        setSearchParams({ tab: key }, { replace: true });
    };

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            {/* 페이지 헤더 */}
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-4">
                일지 관리
            </h1>

            {/* 탭 바 */}
            <div className="flex gap-1 p-1 mb-6 bg-surface-100 dark:bg-surface-800 rounded-xl">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => handleTabChange(tab.key)}
                        className={`
                            flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                            text-sm font-medium transition-all duration-200
                            ${activeTab === tab.key
                                ? 'bg-white dark:bg-surface-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                            }
                        `}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>

                    </button>
                ))}
            </div>

            {/* 탭 콘텐츠 */}
            <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 spinner" /></div>}>
                {activeTab === 'drive' && <DriveLogList />}
                {activeTab === 'daily' && <DailyLogView />}
                {activeTab === 'fuel' && <FuelLogManager />}
                {activeTab === 'hipass' && <HipassChargeLogManager />}
            </Suspense>
        </div>
    );
}
