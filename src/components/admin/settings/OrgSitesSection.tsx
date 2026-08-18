/**
 * OrgSitesSection — Settings의 출발지(분관) 관리 섹션
 *
 * 기관 주소(본관)는 고유번호증에서 읽은 값이라 여기서 고칠 수 없다. 이 카드는 **분관만** 다룬다.
 * 상태와 저장 로직은 부모(useSettings)가 소유하고 props로 받는다.
 */
import type { SettingsForm } from '../../../hooks/useSettings';
import type { OrgSite } from '../../../lib/orgSites';

interface OrgSitesSectionProps {
    form: SettingsForm;
    onAddSite: () => void;
    onSiteChange: (id: string, patch: Partial<Omit<OrgSite, 'id'>>) => void;
    onRemoveSite: (id: string) => void;
    onSaveSites: () => void;
    saving: boolean;
}

export default function OrgSitesSection({
    form, onAddSite, onSiteChange, onRemoveSite, onSaveSites, saving,
}: OrgSitesSectionProps) {
    return (
        <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">출발지 (분관)</h2>
            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                분관·별관처럼 차를 세워 두는 곳이 따로 있으면 여기에 등록하세요. 등록하면 [차량 관리]에서
                차량마다 출발지를 고를 수 있고, 예약·바로 운행의 거리·소요시간·통행료가 그 주소 기준으로 계산됩니다.
            </p>

            {/* 본관은 편집 대상이 아니라는 것을 화면으로 보여 준다 */}
            <div className="flex justify-between items-center p-3 mb-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                <span className="text-sm text-surface-500 dark:text-surface-400">본관 (기관 주소)</span>
                <span className="text-sm text-surface-600 dark:text-surface-300 truncate ml-3">
                    {form.address || '주소 미입력'}
                </span>
            </div>

            <div className="space-y-3">
                {form.sites.map(site => (
                    <div key={site.id} className="p-3 border border-surface-200 dark:border-surface-700 rounded-xl space-y-2">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={site.name}
                                onChange={e => onSiteChange(site.id, { name: e.target.value })}
                                className="input flex-1 min-h-[48px]"
                                placeholder="출발지 이름 (예: 제2분관)"
                                aria-label="출발지 이름"
                            />
                            <button
                                type="button"
                                onClick={() => onRemoveSite(site.id)}
                                className="px-3 min-h-[48px] rounded-xl text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                aria-label={`${site.name || '이름 없는 출발지'} 삭제`}
                            >
                                삭제
                            </button>
                        </div>
                        <input
                            type="text"
                            value={site.address}
                            onChange={e => onSiteChange(site.id, { address: e.target.value })}
                            className="input min-h-[48px]"
                            placeholder="주소 (예: 서울시 ○○구 ○○로 12)"
                            aria-label="출발지 주소"
                        />
                    </div>
                ))}
            </div>

            {form.sites.length === 0 && (
                <p className="text-xs text-surface-400 dark:text-surface-500">
                    등록된 분관이 없습니다. 모든 차량이 기관 주소(본관)에서 출발하는 것으로 계산됩니다.
                </p>
            )}

            <div className="flex justify-between items-center gap-3 mt-4">
                <button type="button" onClick={onAddSite} className="btn-secondary min-h-[48px]">
                    + 출발지 추가
                </button>
                <button type="button" onClick={onSaveSites} disabled={saving} className="btn-primary min-h-[48px]">
                    {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '출발지 저장'}
                </button>
            </div>
        </div>
    );
}
