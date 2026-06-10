import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 전역 Mock: useAnalytics.ts에서 사용하는 통계 함수가 실제 DB에 접근하지 못하도록 차단
vi.mock('@/lib/firestore/statistics', () => ({
    getMonthlyStats: vi.fn().mockResolvedValue([]),
}));