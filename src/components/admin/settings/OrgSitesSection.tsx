/**
 * OrgSitesSection — Settings의 출발지(분관) 관리 섹션
 *
 * 기관 주소(본관)는 고유번호증에서 읽은 값이라 여기서 고칠 수 없다. 이 카드는 **분관만** 다룬다.
 * 상태와 저장 로직은 부모(useSettings)가 소유하고 props로 받는다.
 *
 * 저장이 끝난 출발지는 입력칸을 접고 본관과 같은 **한 줄 목록**으로 보여 준다. 입력칸이
 * 그대로 남아 있으면 토스트가 사라진 뒤에는 저장이 됐는지 알 수 없고, [출발지 저장] 버튼도
 * 아직 눌러야 할 것처럼 계속 보인다. 편집은 그 줄의 [수정]으로 연다.
 */
import { useState } from 'react';
import type { SettingsForm } from '../../../hooks/useSettings';
import type { OrgSite } from '../../../lib/orgSites';

interface OrgSitesSectionProps {
    form: SettingsForm;
    /** 새 줄을 추가하고 그 id를 돌려준다 */
    onAddSite: () => string;
    onSiteChange: (id: string, patch: Partial<Omit<OrgSite, 'id'>>) => void;
    onRemoveSite: (id: string) => void;
    /** 저장 성공 여부 — false면 편집칸을 접지 않는다 */
    onSaveSites: () => Promise<boolean>;
    saving: boolean;
}

export default function OrgSitesSection({
    form, onAddSite, onSiteChange, onRemoveSite, onSaveSites, saving,
}: OrgSitesSectionProps) {
    /** 편집 중인 줄의 '편집을 시작한 시점의 값' — [취소]가 되돌릴 자리다. */
    const [drafts, setDrafts] = useState<Record<string, OrgSite>>({});
    const editingCount = Object.keys(drafts).length;

    const handleAdd = () => {
        const id = onAddSite();
        setDrafts(prev => ({ ...prev, [id]: { id, name: '', address: '' } }));
    };

    const startEdit = (site: OrgSite) => {
        setDrafts(prev => ({ ...prev, [site.id]: { ...site } }));
    };

    const cancelEdit = (id: string) => {
        const original = drafts[id];
        setDrafts(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        if (!original) return;
        // 한 번도 저장한 적 없는 빈 줄은 취소가 곧 제거다(서버 호출 없이 목록에서만 사라진다).
        if (!original.name.trim() && !original.address.trim()) onRemoveSite(id);
        else onSiteChange(id, { name: original.name, address: original.address });
    };

    const handleSave = async () => {
        if (await onSaveSites()) setDrafts({});
    };

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
                {form.sites.map(site => drafts[site.id] ? (
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
                                onClick={() => cancelEdit(site.id)}
                                className="px-3 min-h-[48px] rounded-xl text-sm text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                            >
                                취소
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
                ) : (
                    <div key={site.id} className="flex justify-between items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-surface-700 dark:text-surface-200 truncate">
                                {site.name || '이름 없음'}
                            </p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 truncate">
                                {site.address || '주소 미입력'}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                type="button"
                                onClick={() => startEdit(site)}
                                className="px-3 min-h-[44px] rounded-xl text-sm text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                aria-label={`${site.name || '이름 없는 출발지'} 수정`}
                            >
                                수정
                            </button>
                            <button
                                type="button"
                                onClick={() => onRemoveSite(site.id)}
                                className="px-3 min-h-[44px] rounded-xl text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                aria-label={`${site.name || '이름 없는 출발지'} 삭제`}
                            >
                                삭제
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {form.sites.length === 0 && (
                <p className="text-xs text-surface-400 dark:text-surface-500">
                    등록된 분관이 없습니다. 모든 차량이 기관 주소(본관)에서 출발하는 것으로 계산됩니다.
                </p>
            )}

            <div className="flex justify-between items-center gap-3 mt-4">
                <button type="button" onClick={handleAdd} className="btn-secondary min-h-[48px]">
                    + 출발지 추가
                </button>
                {/* 편집 중인 줄이 없으면 저장할 것도 없다 — 버튼이 남아 있으면 아직 안 눌렀나 싶어진다 */}
                {editingCount > 0 && (
                    <button type="button" onClick={handleSave} disabled={saving} className="btn-primary min-h-[48px]">
                        {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '출발지 저장'}
                    </button>
                )}
            </div>
        </div>
    );
}
