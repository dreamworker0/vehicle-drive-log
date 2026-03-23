/**
 * OrgMapView — 기관 위치 지도 컴포넌트
 * Leaflet + OpenStreetMap (무료, API 키 불필요)
 * Firestore에 사전 저장된 lat/lng 좌표를 직접 사용 (즉시 표시)
 * 마커 팝업에서 좌표 수정 가능
 */
import { useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
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
            leafletMap.current?.remove();
            leafletMap.current = null;
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
            popupContent.innerHTML = `
                <div style="min-width:200px">
                    <strong>${org.name}</strong><br/>
                    <span style="font-size:12px;color:#666">${org.address}</span><br/>
                    <span style="font-size:11px;color:#999">좌표: ${org.lat.toFixed(4)}, ${org.lng.toFixed(4)}</span>
                    <div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px">
                        <div style="font-size:11px;color:#666;margin-bottom:4px">좌표 수정:</div>
                        <div style="display:flex;gap:4px;align-items:center">
                            <input type="number" step="any" placeholder="위도" value="${org.lat}" 
                                style="width:80px;padding:3px 6px;font-size:11px;border:1px solid #ddd;border-radius:4px" 
                                class="coord-lat" />
                            <input type="number" step="any" placeholder="경도" value="${org.lng}" 
                                style="width:80px;padding:3px 6px;font-size:11px;border:1px solid #ddd;border-radius:4px" 
                                class="coord-lng" />
                            <button class="coord-save" style="padding:3px 8px;font-size:11px;background:#059669;color:white;border:none;border-radius:4px;cursor:pointer">
                                저장
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const saveBtn = popupContent.querySelector('.coord-save') as HTMLButtonElement;
            saveBtn.addEventListener('click', async () => {
                const latInput = popupContent.querySelector('.coord-lat') as HTMLInputElement;
                const lngInput = popupContent.querySelector('.coord-lng') as HTMLInputElement;
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
                    await updateDoc(doc(db, 'organizations', org.id), { lat, lng });
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

        // 마커가 있으면 bounds 맞추기
        if (markersRef.current.length > 0) {
            const group = L.featureGroup(markersRef.current);
            map.fitBounds(group.getBounds().pad(0.2));
        }
    }, [orgs]);

    return (
        <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                    📍 기관 위치 지도
                </h2>
                <span className="text-xs text-surface-400">
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
