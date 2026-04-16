/**
 * PublicNav — 비로그인 공개 페이지 상단 네비게이션 바
 * 랜딩·업데이트 소식·FAQ 등 공개 페이지에서 공유하는 상단 메뉴
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface NavItem {
    href: string;
    label: string;
}

const NAV_ITEMS: NavItem[] = [
    { href: '/release-notes', label: '업데이트 소식' },
    { href: '/faq', label: '자주 하는 질문' },
];

interface PublicNavProps {
    /** 랜딩 페이지처럼 파란 배경 위에 겹쳐 표시할 때 true */
    variant?: 'overlay' | 'solid';
}

export default function PublicNav({ variant = 'solid' }: PublicNavProps) {
    const { pathname } = useLocation();
    const [isScrolled, setIsScrolled] = useState(false);

    const isOverlay = variant === 'overlay';

    // overlay 모드일 때 스크롤 위치에 따라 배경 전환
    useEffect(() => {
        if (!isOverlay) return;

        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10);
        };

        // 초기 상태 설정
        handleScroll();

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [isOverlay]);

    return (
        <nav
            className={`w-full border-b transition-colors duration-300 fixed top-0 z-50 ${
                isOverlay
                    ? isScrolled ? 'bg-white/80 dark:bg-surface-900/80 backdrop-blur-md border-surface-200 dark:border-surface-700 shadow-sm' : 'bg-transparent border-transparent'
                    : 'bg-white/80 dark:bg-surface-900/80 backdrop-blur-md border-surface-200 dark:border-surface-700 shadow-sm'
            }`}
            aria-label="메인 메뉴"
        >
            <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
                <a
                    href="/"
                    className={`text-sm font-semibold tracking-tight transition-colors ${
                        isOverlay
                            ? isScrolled ? 'text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400' : 'text-white/90 hover:text-white'
                            : 'text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400'
                    }`}
                >
                    차량 운행일지
                </a>
                <div className="flex items-center gap-1">
                    {NAV_ITEMS.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <a
                                key={item.href}
                                href={item.href}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    isOverlay
                                        ? isScrolled
                                            ? isActive
                                                ? 'text-primary-700 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30'
                                                : 'text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
                                            : isActive
                                                ? 'text-white bg-white/15'
                                                : 'text-white/80 hover:text-white hover:bg-white/10'
                                        : isActive
                                          ? 'text-primary-700 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30'
                                          : 'text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
                                }`}
                            >
                                {item.label}
                            </a>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
