import { memo, useEffect, useRef, useState } from 'react';
import type { DriveLogForm } from '../../../hooks/driveLogForm/types';
import { canChooseSite, MAIN_SITE_ID, type OrgSite } from '../../../lib/orgSites';

interface SiteSectionProps {
    form: DriveLogForm;
    setForm: (f: DriveLogForm) => void;
    /** 기관의 출발지 목록(본관 + 분관) */
    orgSites: OrgSite[];
    /** 선택된 차량 — 출발지가 매번 바뀌는 차량에만 선택을 연다 */
    selectedVehicle?: { id?: string; siteVaries?: boolean } | null;
}

/**
 * 출발지 · 차를 세운 곳 선택.
 *
 * `WaypointSection`에서 분리한 이유는 그 섹션이 예약에서 넘어온 운행일지에서는 통째로
 * `null`을 반환하기 때문이다(목적·행선지를 예약이 이미 채웠으므로). 출발지는 예약이 채우지
 * 못하는 값이고, 예약 → 도착 → 일지가 **가장 흔한 경로**라 거기서 선택이 보이지 않으면
 * 기능 자체가 닿지 않는다. 더 나쁜 것은 값이 기본값 그대로 저장되면서 차량의 현재 위치에
 * 새 확인 시각이 찍힌다는 것이다 — 아무도 확인하지 않은 위치가 방금 확인된 것처럼 보인다.
 */
const SiteSection = memo(function SiteSection({
    form,
    setForm,
    orgSites,
    selectedVehicle,
}: SiteSectionProps) {
    /**
     * 세운 곳을 사용자가 직접 건드렸는가. 건드리기 전까지는 출발지를 따라가고(대부분 왕복이라
     * 확인만 하고 넘어간다), 한 번 고른 뒤에는 따라가지 않는다 — 편도로 세운 곳을 지정했는데
     * 출발지를 고치다가 조용히 되돌아가면 차량 위치가 틀어진다.
     */
    const [endSiteTouched, setEndSiteTouched] = useState(false);

    // 차량이 바뀌면 손댄 기록도 함께 잊는다. 이 컴포넌트는 리마운트되지 않으므로, 남겨 두면
    // 다른 차량에서 출발지를 바꿔도 세운 곳이 따라오지 않는 이유 없는 상태가 이어진다.
    const vehicleId = selectedVehicle?.id;
    const touchedForVehicleRef = useRef<string | undefined>(vehicleId);
    useEffect(() => {
        if (touchedForVehicleRef.current !== vehicleId) {
            touchedForVehicleRef.current = vehicleId;
            setEndSiteTouched(false);
        }
    }, [vehicleId]);

    // 분관 등록만으로는 열지 않는다 — 분관 기능은 원래 분산되어 있지만 **고정된** 차량을 위한
    // 것이라, 그 기관 운전자에게는 얻는 것 없이 잘못 고를 기회만 생긴다.
    if (!canChooseSite(orgSites, selectedVehicle)) return null;

    const startSiteId = form.startSiteId || MAIN_SITE_ID;
    const endSiteId = form.endSiteId || MAIN_SITE_ID;

    const handleStartSiteChange = (value: string) => {
        setForm({
            ...form,
            startSiteId: value,
            ...(endSiteTouched ? {} : { endSiteId: value }),
        });
    };

    const handleEndSiteChange = (value: string) => {
        setEndSiteTouched(true);
        setForm({ ...form, endSiteId: value });
    };

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="startSiteId" className="label">출발지</label>
                <select
                    id="startSiteId"
                    value={startSiteId}
                    onChange={e => handleStartSiteChange(e.target.value)}
                    className="input min-h-[48px]"
                >
                    {orgSites.map(site => (
                        <option key={site.id} value={site.id}>{site.name}</option>
                    ))}
                </select>
            </div>
            <div>
                <label htmlFor="endSiteId" className="label">차를 세운 곳</label>
                <select
                    id="endSiteId"
                    value={endSiteId}
                    onChange={e => handleEndSiteChange(e.target.value)}
                    className="input min-h-[48px]"
                >
                    {orgSites.map(site => (
                        <option key={site.id} value={site.id}>{site.name}</option>
                    ))}
                </select>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                    다음에 이 차를 여기서 찾게 됩니다.
                </p>
            </div>
        </div>
    );
});

export default SiteSection;
