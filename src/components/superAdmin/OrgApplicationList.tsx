import { useState, useEffect } from 'react';
import { getPendingOrganizations, getRejectedOrganizations, rejectOrganization, deleteOrganization, createNotification, updateOrganization, generateInviteCode, getOrganizationAdmins, approveOrganizationWithAdmins } from '../../lib/firestore';
import { sendApprovalEmail } from '../../lib/emailService';
import { ocrDocumentVerify } from '../../lib/ocr';
import OrgAppCard from './OrgAppCard';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import type { Organization } from '../../types';

interface OrgApplicationListProps {
    onCountChange?: () => void;
}

export default function OrgApplicationList({ onCountChange }: OrgApplicationListProps) {
    const [tab, setTab] = useState<'pending' | 'rejected'>('pending');
    const [applications, setApplications] = useState<Organization[]>([]);
    const [rejectedApps, setRejectedApps] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
    const [selectedApp, setSelectedApp] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const fetchData = async () => {
        try {
            const [pending, rejected] = await Promise.all([
                getPendingOrganizations(),
                getRejectedOrganizations()
            ]);
            setApplications(pending as Organization[]);
            setRejectedApps(rejected as Organization[]);
            onCountChange?.();
        } catch (err) {
            console.error('데이터 조회 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    // 최초 1회 데이터 조회
    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleApprove = async (app: Organization) => {
        setActionLoading(prev => ({ ...prev, [app.id]: 'approve' }));
        try {
            const inviteCode = generateInviteCode();
            const admins = await getOrganizationAdmins(app.id);

            // 기관 승인(status/approvedAt/inviteCode)과 소속 관리자 상태 갱신을
            // 하나의 배치로 원자적으로 커밋 — 중간 실패로 인한 불일치 방지
            await approveOrganizationWithAdmins(app.id, inviteCode, admins.map(a => a.id));

            // 인앱 알림은 best-effort (실패해도 승인은 유지)
            try {
                for (const admin of admins) {
                    await createNotification({
                        targetUid: admin.id,
                        type: 'approval',
                        title: '기관 승인 완료',
                        message: `${app.name} 기관이 승인되었습니다. 초대 코드: ${inviteCode}`,
                        organizationId: app.id,
                    });
                }
            } catch (notifyErr) {
                console.warn('승인 알림 생성 실패 (승인은 완료됨):', notifyErr);
            }

            // 이메일 발송 (실패해도 승인은 유지)
            try {
                console.debug('📋 승인된 기관 데이터:', JSON.stringify(app));
                if (app.applicantEmail) {
                    await sendApprovalEmail(app.applicantEmail, app.name, inviteCode, app.applicantName);
                    console.debug('📧 수동 승인 이메일 발송 완료');
                } else {
                    console.warn('⚠️ 신청자 이메일이 없어서 이메일을 보낼 수 없습니다');
                    showToast('신청자 이메일 정보가 없어서 승인 이메일을 보내지 못했습니다.', 'warning');
                }
            } catch (emailErr) {
                console.warn('승인 이메일 발송 실패 (승인은 완료됨):', emailErr);
                showToast(`승인은 완료되었지만, 이메일 발송에 실패했습니다.\n초대코드: ${inviteCode}`, 'warning');
            }

            // 알림톡 발송 (실패해도 승인은 유지)
            try {
                if (app.applicantPhone) {
                    const { getFunctions, httpsCallable } = await import('firebase/functions');
                    const functions = getFunctions(undefined, 'asia-northeast3');
                    const sendAlimtalk = httpsCallable(functions, 'sendManualApprovalAlimtalk');
                    await sendAlimtalk({ orgId: app.id });
                    console.debug('📱 수동 승인 알림톡 발송 완료');
                } else {
                    console.warn('⚠️ 신청자 전화번호가 없어서 알림톡을 보낼 수 없습니다');
                }
            } catch (alimtalkErr) {
                console.warn('알림톡 발송 실패 (승인은 완료됨):', alimtalkErr);
            }

            // 상태 업데이트
            setApplications(prev => prev.filter(a => a.id !== app.id));
            onCountChange?.();

        } catch (err) {
            console.error('승인 실패:', err);
            showToast('기관 승인 처리에 실패했습니다.', 'error');
        } finally {
            setActionLoading(prev => ({ ...prev, [app.id]: null }));
        }
    };

    const handleReject = async (app: Organization, reason: string) => {
        if (!reason.trim()) return;

        setActionLoading(prev => ({ ...prev, [app.id]: 'reject' }));
        try {
            await rejectOrganization(app.id, reason);

            // In-app 알림 생성
            const admins = await getOrganizationAdmins(app.id);
            for (const admin of admins) {
                await createNotification({
                    targetUid: admin.id,
                    type: 'rejection',
                    title: '기관 승인 거절',
                    message: `${app.name} 기관 신청이 거절되었습니다.\n사유: ${reason}`,
                    organizationId: app.id,
                });
            }

            // 반려 이메일 발송
            try {
                if (app.applicantEmail) {
                    const { getFunctions, httpsCallable } = await import('firebase/functions');
                    const functions = getFunctions(undefined, 'asia-northeast3');
                    const sendRejectionEmail = httpsCallable(functions, 'sendRejectionEmail');
                    await sendRejectionEmail({
                        recipientEmail: app.applicantEmail,
                        orgName: app.name,
                        applicantName: app.applicantName,
                        reason: reason,
                    });
                    console.debug('📧 반려 이메일 발송 완료');
                } else {
                    console.warn('⚠️ 신청자 이메일이 없어 반려 안내 이메일을 발송하지 못했습니다.');
                }
            } catch (emailErr) {
                console.warn('반려 이메일 발송 실패:', emailErr);
                showToast('반려 처리는 완료되었으나 이메일 발송에 실패했습니다.', 'warning');
            }

            // 반려 알림톡 발송 (실패해도 반려는 유지)
            try {
                if (app.applicantPhone) {
                    const { getFunctions, httpsCallable } = await import('firebase/functions');
                    const functions = getFunctions(undefined, 'asia-northeast3');
                    const sendRejectionAlimtalk = httpsCallable(functions, 'sendManualRejectionAlimtalk');
                    await sendRejectionAlimtalk({ orgId: app.id, reason });
                    console.debug('📱 반려 알림톡 발송 완료');
                } else {
                    console.warn('⚠️ 신청자 전화번호가 없어 반려 알림톡을 발송하지 못했습니다.');
                }
            } catch (alimtalkErr) {
                console.warn('반려 알림톡 발송 실패 (반려는 완료됨):', alimtalkErr);
            }

            // 로컬 상태 업데이트
            setApplications(prev => prev.filter(a => a.id !== app.id));
            setRejectedApps(prev => [{ ...app, status: 'rejected' }, ...prev]);
            onCountChange?.();

        } catch (err) {
            console.error('거절 실패:', err);
            showToast('기관 반려 처리에 실패했습니다.', 'error');
        } finally {
            setActionLoading(prev => ({ ...prev, [app.id]: null }));
        }
    };

    const handleDelete = async (app: Organization) => {
        if (!await confirm({ message: `${app.name} 기관의 신청 기록을 완전히 삭제하시겠습니까?`, confirmColor: 'danger' })) return;

        setActionLoading(prev => ({ ...prev, [app.id]: 'delete' }));
        try {
            await deleteOrganization(app.id);

            setRejectedApps(prev => prev.filter(a => a.id !== app.id));
        } catch (err) {
            console.error('삭제 실패:', err);
        } finally {
            setActionLoading(prev => ({ ...prev, [app.id]: null }));
        }
    };

    // 거절된 신청을 대기중으로 되돌리기
    const handleMoveToPending = async (app: Organization) => {
        if (!await confirm({ message: `${app.name} 기관의 신청을 대기 중 상태로 되돌리시겠습니까?` })) return;

        setActionLoading(prev => ({ ...prev, [app.id]: 'moveToPending' }));
        try {
            await updateOrganization(app.id, {
                status: 'pending',
                rejectedAt: null,
            } as Record<string, unknown>);
            showToast(`${app.name} 기관이 대기 중으로 이동되었습니다.`, 'success');
            setRejectedApps(prev => prev.filter(a => a.id !== app.id));
            setApplications(prev => [{ ...app, status: 'pending' }, ...prev]);
            onCountChange?.();
        } catch (err) {
            console.error('대기중 이동 실패:', err);
            showToast('대기중으로 이동하는데 실패했습니다.', 'error');
        } finally {
            setActionLoading(prev => ({ ...prev, [app.id]: null }));
        }
    };

    // AI 재분석
    const handleAiReanalyze = async (app: Organization) => {
        if (!app.uniqueNumberImageUrl) {
            showToast('고유번호증 사본이 없어 AI 분석을 할 수 없습니다.', 'warning');
            return;
        }
        setActionLoading(prev => ({ ...prev, [app.id]: 'ai' }));
        try {
            const ocrResult = await ocrDocumentVerify(app.uniqueNumberImageUrl!, app.name) as Record<string, unknown>;
            await updateOrganization(app.id, {
                aiVerified: ocrResult.aiVerified || false,
                aiVerifyDetail: {
                    documentType: ocrResult.documentType,
                    uniqueNumber: ocrResult.uniqueNumber,
                    extractedName: ocrResult.extractedName,
                    nameMatch: ocrResult.nameMatch,
                    address: ocrResult.address,
                },
                uniqueNumber: ocrResult.uniqueNumber || '',
                address: ocrResult.address || '',
            } as Record<string, unknown>);

            const updatedApp = {
                ...app,
                aiVerified: ocrResult.aiVerified as boolean || false,
                aiVerifyDetail: {
                    documentType: ocrResult.documentType as string,
                    uniqueNumber: ocrResult.uniqueNumber as string,
                    extractedName: ocrResult.extractedName as string,
                    nameMatch: ocrResult.nameMatch as boolean,
                    address: ocrResult.address as string,
                },
                uniqueNumber: (ocrResult.uniqueNumber as string) || '',
                address: (ocrResult.address as string) || '',
            };
            setApplications(prev => prev.map(a => a.id === app.id ? updatedApp : a));
            setRejectedApps(prev => prev.map(a => a.id === app.id ? updatedApp : a));

        } catch (err) {
            console.error('AI 재분석 실패:', err);
            showToast('AI 문서 분석에 실패했습니다. 이미지가 선명한지 확인 후 다시 시도해주세요.', 'error');
        } finally {
            setActionLoading(prev => ({ ...prev, [app.id]: null }));
        }
    };

    const rawList = tab === 'pending' ? applications : rejectedApps;
    const currentList = rawList.filter(app => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            app.name?.toLowerCase().includes(q) ||
            app.applicantName?.toLowerCase().includes(q) ||
            app.applicantEmail?.toLowerCase().includes(q) ||
            app.applicantPhone?.includes(q) ||
            app.uniqueNumber?.toLowerCase().includes(q) ||
            app.address?.toLowerCase().includes(q)
        );
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">기관 신청 관리</h1>
                <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">기관 신청을 검토하고 관리하세요</p>
            </div>

            {/* 탭 */}
            <div className="flex gap-1 mb-4 bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
                <button
                    onClick={() => setTab('pending')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all min-h-[48px] ${tab === 'pending'
                        ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                        : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'
                        }`}
                >
                    대기 중 {applications.length > 0 && (
                        <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full badge-warning dark:text-amber-300">
                            {applications.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setTab('rejected')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all min-h-[48px] ${tab === 'rejected'
                        ? 'bg-white dark:bg-surface-700 text-red-600 dark:text-red-400 shadow-sm'
                        : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'
                        }`}
                >
                    거절됨 {rejectedApps.length > 0 && (
                        <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full badge-danger dark:text-red-300">
                            {rejectedApps.length}
                        </span>
                    )}
                </button>
            </div>

            {/* 검색 */}
            {(applications.length > 0 || rejectedApps.length > 0) && (
                <div className="mb-4">
                    <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="input pl-10 min-h-[48px]"
                            placeholder="기관명, 신청자, 이메일, 전화번호 검색"
                        />
                    </div>
                </div>
            )}

            {currentList.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 dark:text-surface-600 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                    </svg>
                    <p className="text-surface-400 dark:text-surface-500 text-lg font-medium">
                        {searchQuery.trim()
                            ? '검색 결과가 없습니다'
                            : tab === 'pending' ? '대기 중인 신청이 없습니다' : '거절된 신청 내역이 없습니다'
                        }
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {currentList.map(app => (
                        <OrgAppCard
                            key={app.id}
                            app={app}
                            tab={tab}
                            actionLoading={actionLoading}
                            selectedApp={selectedApp}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            onDelete={handleDelete}
                            onMoveToPending={handleMoveToPending}
                            onAiReanalyze={handleAiReanalyze}
                            onToggleImage={(id) => setSelectedApp(selectedApp === id ? null : id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
