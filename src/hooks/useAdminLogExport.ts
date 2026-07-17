/**
 * useAdminLogExport — 관리자 로그 화면(주유/정비/하이패스)의 공통 내보내기 로직.
 * 세 화면이 동일하게 반복하던 (1) 기관 정보 로드 (2) 결재란 계산
 * (3) 엑셀/PDF 다운로드의 try/catch·토스트 처리를 한 곳으로 모은다.
 * 실제 다운로드 함수(엑셀/PDF)와 인자는 화면마다 다르므로, 화면이 task 콜백 안에서
 * 동적 import + 호출을 담당하고 이 훅은 공통 껍데기만 제공한다.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getOrganization } from '../lib/firestore';
import type { Organization } from '../types/organization';

/** 결재란 기본값 — 기관에 별도 설정이 없을 때 사용 */
const DEFAULT_APPROVAL: { title: string }[] = [{ title: '담당' }, { title: '팀장' }];

export function useAdminLogExport() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [org, setOrg] = useState<Organization | null>(null);
    const orgName = org?.name || '';

    useEffect(() => {
        if (!userData?.organizationId) return;
        getOrganization(userData.organizationId).then((o) => {
            if (o) setOrg(o as Organization);
        }).catch(err => console.error('getOrganization failed:', err));
    }, [userData?.organizationId]);

    // 결재란: 숨김 설정이면 빈 배열, 커스텀이 있으면 그것, 없으면 기본값
    const approvalLine = useMemo(() => {
        if (org?.hideApprovalLine) return [];
        return (org?.approvalLine?.length ?? 0) > 0 ? org!.approvalLine! : DEFAULT_APPROVAL;
    }, [org]);

    // 엑셀 다운로드 공통 래퍼 — task가 동적 import + 실제 호출을 수행
    const runExcel = useCallback(async (task: () => Promise<void>) => {
        try {
            await task();
        } catch (err) {
            console.error('엑셀 다운로드 실패:', err);
            showToast('엑셀 다운로드 중 오류가 발생했습니다.', 'error');
        }
    }, [showToast]);

    // PDF 다운로드 공통 래퍼
    const runPdf = useCallback(async (task: () => void | Promise<void>) => {
        try {
            await task();
        } catch (err) {
            console.error('PDF 다운로드 실패:', err);
            showToast('PDF 다운로드 중 오류가 발생했습니다.', 'error');
        }
    }, [showToast]);

    return { org, orgName, approvalLine, runExcel, runPdf };
}

export default useAdminLogExport;
