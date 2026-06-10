/**
 * OrgMapView — 기관 위치 지도 컴포넌트
 * Leaflet + OpenStreetMap (무료, API 키 불필요)
 * Firestore에 사전 저장된 lat/lng 좌표를 직접 사용 (즉시 표시)
 * 마커 팝업에서 좌표 수정 가능
 */
import { useEffect, useRef } from 'react';
import { updateOrganization } from '../../lib/firestore';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet 기본 마커 아이콘 경로 수정 (Vite 번들링 이슈 해결)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

interface OrgLocation {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
}

interface OrgMapViewProps {
    orgs: OrgLocation[];
}

export default function OrgMapView({ orgs }: OrgMapViewProps) {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const markersRef = useRef<L.Marker[]>([]);

    useEffect(() => {
        if (!mapRef.current || leafletMap.current) return;

        leafletMap.current = L.map(mapRef.current).setView([36.5, 127.5], 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(leafletMap.current);

        return () => {
            if (leafletMap.current) {
                leafletMap.current.off();
                leafletMap.current.remove();
                leafletMap.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!leafletMap.current || orgs.length === 0) return;

        const map = leafletMap.current;

        // 기존 마커 제거
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        // Firestore 좌표로 즉시 마커 생성
        orgs.forEach(org => {
            if (!org.lat || !org.lng) return;

            const popupContent = document.createElement('div');

            // XSS 방지: innerHTML 대신 DOM API 사용 (Firestore 데이터 직접 삽입 금지)
            const wrapper = document.createElement('div');
            wrapper.style.minWidth = '200px';

            const nameEl = document.createElement('strong');
            nameEl.textContent = org.name;
            wrapper.appendChild(nameEl);
            wrapper.appendChild(document.createElement('br'));

            const addressEl = document.createElement('span');
            addressEl.style.cssText = 'font-size:12px;color:#666';
            addressEl.textContent = org.address;
            wrapper.appendChild(addressEl);
            wrapper.appendChild(document.createElement('br'));

            const coordEl = document.createElement('span');
            coordEl.style.cssText = 'font-size:11px;color:#999';
            coordEl.textContent = `좌표: ${org.lat.toFixed(4)}, ${org.lng.toFixed(4)}`;
            wrapper.appendChild(coordEl);

            const editSection = document.createElement('div');
            editSection.style.cssText = 'margin-top:8px;border-top:1px solid #eee;padding-top:8px';

            const editLabel = document.createElement('div');
            editLabel.style.cssText = 'font-size:11px;color:#666;margin-bottom:4px';
            editLabel.textContent = '좌표 수정:';
            editSection.appendChild(editLabel);

            const inputRow = document.createElement('div');
            inputRow.style.cssText = 'display:flex;gap:4px;align-items:center';

            const latInput = document.createElement('input');
            latInput.type = 'number';
            latInput.step = 'any';
            latInput.placeholder = '위도';
            latInput.value = String(org.lat);
            latInput.style.cssText = 'width:80px;padding:3px 6px;font-size:11px;border:1px solid #ddd;border-radius:4px';
            latInput.className = 'coord-lat';

            const lngInput = document.createElement('input');
            lngInput.type = 'number';
            lngInput.step = 'any';
            lngInput.placeholder = '경도';
            lngInput.value = String(org.lng);
            lngInput.style.cssText = 'width:80px;padding:3px 6px;font-size:11px;border:1px solid #ddd;border-radius:4px';
            lngInput.className = 'coord-lng';

            const saveBtn = document.createElement('button');
            saveBtn.className = 'coord-save';
            saveBtn.style.cssText = 'padding:3px 8px;font-size:11px;background:#059669;color:white;border:none;border-radius:4px;cursor:pointer';
            saveBtn.textContent = '저장';

            inputRow.appendChild(latInput);
            inputRow.appendChild(lngInput);
            inputRow.appendChild(saveBtn);
            editSection.appendChild(inputRow);
            wrapper.appendChild(editSection);
            popupContent.appendChild(wrapper);

            saveBtn.addEventListener('click', async () => {
                const lat = parseFloat(latInput.value);
                const lng = parseFloat(lngInput.value);
                if (!lat || !lng || lat < 33 || lat > 43 || lng < 124 || lng > 132) {
                    saveBtn.textContent = '⚠️ 좌표 오류';
                    saveBtn.style.background = '#dc2626';
                    setTimeout(() => { saveBtn.textContent = '저장'; saveBtn.style.background = '#059669'; }, 2000);
                    return;
                }
                saveBtn.disabled = true;
                saveBtn.textContent = '...';
                try {
                    await updateOrganization(org.id, { lat, lng });
                    saveBtn.textContent = '✅';
                    setTimeout(() => window.location.reload(), 1000);
                } catch (err: unknown) {
                    saveBtn.textContent = '❌ 실패';
                    console.error('좌표 저장 실패:', err instanceof Error ? err.message : err);
                    saveBtn.disabled = false;
                }
            });

            const marker = L.marker([org.lat, org.lng])
                .addTo(map)
                .bindPopup(popupContent, { maxWidth: 280 });
            markersRef.current.push(marker);
        });

        // 마커가 있으면 bounds 맞추기 (비동기 줌 트랜지션 에러 방지를 위해 애니메이션 비활성화)
        if (markersRef.current.length > 0) {
            const group = L.featureGroup(markersRef.current);
            map.fitBounds(group.getBounds().pad(0.2), { animate: false });
        }
    }, [orgs]);

    return (
        <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                    📍 기관 위치 지도
                </h2>
                <span className="text-xs text-surface-400 dark:text-surface-500">
                    {orgs.filter(o => o.lat && o.lng).length}개 기관 표시
                </span>
            </div>
            <div
                ref={mapRef}
                className="rounded-xl overflow-hidden border border-surface-200 dark:border-surface-700"
                style={{ height: 840, width: '100%' }}
            />
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-2">
                좌표가 등록된 승인 기관만 표시됩니다 · 마커 클릭 시 좌표 수정 가능 · © OpenStreetMap
            </p>
        </div>
    );
}
