/**
 * UserManual — 사용 설명서 모달
 * 콘텐츠 데이터는 public/data/manualSections.json에서 비동기 로드
 */
import React, { useState, useEffect } from 'react';
import { loadManualSections, type ManualSection } from '../../lib/manualSections';

/* 항목 타입별 스타일 */
interface ItemStyle {
    badge: string;
    badgeCls: string;
    dotCls: string;
}

const ITEM_STYLES: Record<string, ItemStyle> = {
    tip: { badge: '💡 팁', badgeCls: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800', dotCls: 'text-blue-400' },
    warning: { badge: '⚠️ 주의', badgeCls: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800', dotCls: 'text-amber-500' },
    step: { badge: '📌 단계', badgeCls: 'bg-primary-50 text-primary-600 border-primary-200 dark:bg-primary-900/30 dark:text-primary-400 dark:border-primary-800', dotCls: 'text-primary-500' },
};

interface ManualContent {
    text: string;
    type?: 'tip' | 'warning' | 'step' | 'link';
    url?: string;
}

interface UserManualProps {
    role?: 'admin' | 'employee';
    onClose: () => void;
}

function ContentItem({ item }: { item: ManualContent }) {
    /* 링크 타입: 유튜브 등 외부 링크를 클릭 가능한 버튼으로 표시 */
    if (item.type === 'link' && item.url) {
        return (
            <li>
                <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm font-medium text-red-600 dark:text-red-400"
                >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                    {item.text}
                </a>
            </li>
        );
    }

    const style = item.type ? ITEM_STYLES[item.type] : null;

    if (style) {
        return (
            <li className="flex gap-2 text-xs leading-relaxed">
                <span className={`flex-shrink-0 mt-0.5 ${style.dotCls}`}>•</span>
                <span className="flex-1">
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border mr-1.5 align-middle ${style.badgeCls}`}>
                        {style.badge}
                    </span>
                    <span className={item.type === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-surface-600 dark:text-surface-400'}>
                        {item.text}
                    </span>
                </span>
            </li>
        );
    }

    return (
        <li className="flex gap-2 text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
            <span className="text-primary-400 mt-0.5 flex-shrink-0">•</span>
            <span>{item.text}</span>
        </li>
    );
}

interface AccordionItemProps {
    title: string;
    content: (string | ManualContent)[];
    isOpen: boolean;
    onToggle: () => void;
}

function AccordionItem({ title, content, isOpen, onToggle }: AccordionItemProps) {
    return (
        <div className="border-b border-surface-100 dark:border-surface-700 last:border-b-0">
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between p-4 hover:bg-surface-50 dark:bg-surface-800 transition-colors text-left"
            >
                <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{title}</span>
                <svg
                    className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
            </button>
            {isOpen && (
                <div className="px-4 pb-4 animate-fade-in">
                    <ul className="space-y-2">
                        {content.map((item, i) => (
                            <ContentItem key={i} item={typeof item === 'string' ? { text: item } : item} />
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default function UserManual({ role = 'employee', onClose }: UserManualProps) {
    const [sections, setSections] = useState<ManualSection[]>([]);
    const [loading, setLoading] = useState(true);
    const [openIndex, setOpenIndex] = useState(0);

    // 데이터 비동기 로드
    useEffect(() => {
        loadManualSections().then((data) => {
            setSections(role === 'admin' ? data.adminSections : data.employeeSections);
            setLoading(false);
        });
    }, [role]);

    // ESC 키로 닫기
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose} role="presentation">
            <div
                className="bg-white dark:bg-surface-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manual-title"
            >
                {/* 헤더 */}
                <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                            </svg>
                        </div>
                        <div>
                            <h2 id="manual-title" className="text-lg font-bold text-surface-900 dark:text-surface-100">사용 설명서</h2>
                            <p className="text-xs text-surface-400">
                                {role === 'admin' ? '관리자 기능 안내' : '직원 기능 안내'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="btn-icon text-surface-400 hover:text-surface-600 dark:text-surface-400" aria-label="닫기">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* 범례 */}
                <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2 text-[10px]">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-primary-50 text-primary-600 border-primary-200 dark:bg-primary-900/30 dark:text-primary-400 dark:border-primary-800 font-semibold">📌 단계</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800 font-semibold">💡 팁</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 font-semibold">⚠️ 주의</span>
                </div>

                {/* 본문 */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                        </div>
                    ) : (
                        sections.map((section, idx) => (
                            <AccordionItem
                                key={idx}
                                title={section.title}
                                content={section.content as (string | ManualContent)[]}
                                isOpen={openIndex === idx}
                                onToggle={() => setOpenIndex(openIndex === idx ? -1 : idx)}
                            />
                        ))
                    )}
                </div>

                {/* 하단 팁 */}
                <div className="p-4 border-t border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 rounded-b-2xl space-y-2">
                    <a
                        href="/faq"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                        </svg>
                        자주 하는 질문 (FAQ) 보기
                    </a>
                    <p className="text-xs text-surface-400 text-center">
                        💡 궁금한 점이 있으시면 <strong>건의하기</strong>를 이용해 주세요
                    </p>
                </div>
            </div>
        </div>
    );
}
