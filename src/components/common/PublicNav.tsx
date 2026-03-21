/**
 * PublicNav — 비로그인 공개 페이지 상단 네비게이션 바
 * 랜딩·업데이트 소식·FAQ 등 공개 페이지에서 공유하는 상단 메뉴
 */
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

    const isOverlay = variant === 'overlay';

    return (
        <nav
            className={`w-full border-b ${
                isOverlay
                    ? 'bg-white/10 backdrop-blur-md border-white/10'
                    : 'bg-white/80 backdrop-blur-md border-surface-200 shadow-sm'
            }`}
            aria-label="메인 메뉴"
        >
            <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
                <a
                    href="/"
                    className={`text-sm font-semibold tracking-tight transition-colors ${
                        isOverlay
                            ? 'text-white/90 hover:text-white'
                            : 'text-surface-800 hover:text-primary-600'
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
                                        ? isActive
                                            ? 'text-white bg-white/15'
                                            : 'text-white/80 hover:text-white hover:bg-white/10'
                                        : isActive
                                          ? 'text-primary-700 bg-primary-50'
                                          : 'text-surface-500 hover:text-surface-800 hover:bg-surface-100'
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
