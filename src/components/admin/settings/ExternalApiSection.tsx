/**
 * ExternalApiSection — 설정의 "외부 연동(API)" 카드 (기능 사용에서 켠 기관만 보인다)
 *
 * 기관이 직접 만든 프로그램(구글 앱스 스크립트 등)이 차량별 누적 주행거리·하이패스 잔액을
 * 읽어 가는 읽기 전용 API의 키를 발급·교체·폐기한다. 원래 키는 발급 직후 한 번만 보인다.
 * 로직은 useExternalApiKey 훅에 위임.
 */
import { useState } from 'react';
import { useExternalApiKey } from '../../../hooks/useExternalApiKey';

/** 호스팅 재작성(firebase.json)이 vehicleStatusApi로 보내는 경로 */
const API_PATH = '/api/v1/vehicles';

function formatDate(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR');
}

function formatDateTime(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/** 값 한 줄 + 복사 버튼 */
function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);
    const onCopy = async () => {
        const ok = await copyText(value);
        setCopied(ok);
        setFailed(!ok);
        if (ok) setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div>
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">{label}</p>
            <div className="flex items-stretch gap-2">
                <code
                    className={`flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-sm text-surface-800 dark:text-surface-200 break-all select-all ${mono ? 'font-mono' : ''}`}
                >
                    {value}
                </code>
                <button
                    type="button"
                    onClick={() => void onCopy()}
                    className="btn-secondary text-sm flex-shrink-0 min-h-[48px] px-4"
                    aria-label={`${label} 복사`}
                >
                    {copied ? '복사됨' : '복사'}
                </button>
            </div>
            {failed && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">복사하지 못했습니다. 위 값을 길게 눌러 직접 복사해 주세요.</p>
            )}
        </div>
    );
}

export default function ExternalApiSection() {
    const { status, loadFailed, issuedKey, busy, issue, revoke, dismissIssuedKey, reload } = useExternalApiKey();
    const apiUrl = `${window.location.origin}${API_PATH}`;

    const scriptExample = `function readVehicles() {
  // 키는 코드에 적지 말고 [프로젝트 설정 › 스크립트 속성]에 DRIVELOG_API_KEY로 넣어 두세요
  const key = PropertiesService.getScriptProperties().getProperty('DRIVELOG_API_KEY');
  const res = UrlFetchApp.fetch('${apiUrl}', {
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error(res.getContentText());
  const data = JSON.parse(res.getContentText());
  data.vehicles.forEach(function (v) {
    Logger.log(v.name + ' ' + v.currentKm + 'km, 하이패스 ' + v.hipassBalance + '원');
  });
}`;

    const responseExample = `{
  "organizationName": "행복복지관",
  "generatedAt": "2026-11-28T01:00:00.000Z",
  "vehicles": [
    {
      "id": "abc123",
      "name": "스타렉스",
      "plateNumber": "12가3456",
      "currentKm": 120333,
      "hipassBalance": 23000,
      "hipassCardLast4": "3456"
    }
  ]
}`;

    return (
        <div className="glass-card p-6 mb-6">
            {/* 헤더: 제목 + 상태 배지 */}
            <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">🔌 외부 연동(API)</h2>
                {status === null ? (
                    <div className="w-4 h-4 spinner flex-shrink-0 mt-1" />
                ) : status.hasKey ? (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full flex-shrink-0">● 키 사용 중</span>
                ) : (
                    <span className="text-xs font-medium text-surface-600 dark:text-surface-400 bg-surface-100 dark:bg-surface-800 px-2.5 py-1 rounded-full flex-shrink-0">키 없음</span>
                )}
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-5">
                기관에서 직접 만든 프로그램이 아래 주소로 <strong className="text-surface-700 dark:text-surface-300">차량별 누적 주행거리와 하이패스 잔액</strong>을 읽어 갈 수 있습니다.
                읽기만 할 수 있고 운행일지는 바뀌지 않습니다. 이용료는 없습니다.
            </p>

            <div className="space-y-4">
                <CopyField label="요청 주소 (GET)" value={apiUrl} />

                {/* 방금 발급한 키 — 한 번만 보인다 */}
                {issuedKey && (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 space-y-3">
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">⚠️ 이 키는 지금 한 번만 보입니다</p>
                        <p className="text-xs text-amber-700 dark:text-amber-300/90">
                            화면을 벗어나면 다시 볼 수 없습니다. 지금 복사해서 프로그램의 안전한 곳(앱스 스크립트라면 스크립트 속성)에 넣어 두세요.
                            잃어버리면 새로 발급하면 됩니다.
                        </p>
                        <CopyField label="API 키" value={issuedKey} />
                        <button type="button" onClick={dismissIssuedKey} className="btn-secondary text-sm min-h-[48px] w-full">
                            복사해 두었어요
                        </button>
                    </div>
                )}

                {/* 키 상태·조작 */}
                {status === null ? (
                    <div className="flex justify-center py-4"><div className="w-5 h-5 spinner" /></div>
                ) : loadFailed ? (
                    <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700">
                        <p className="text-sm text-surface-600 dark:text-surface-300">키 상태를 불러오지 못했습니다.</p>
                        <button type="button" onClick={() => void reload()} className="btn-secondary text-sm min-h-[48px]">다시 시도</button>
                    </div>
                ) : status.hasKey ? (
                    <div className="p-3.5 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700">
                        <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                            API 키 <span className="font-mono">••••{status.hint}</span>
                        </p>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            {formatDate(status.createdAt) ? `${formatDate(status.createdAt)} 발급` : '발급됨'}
                            {' · '}
                            {status.lastUsedAt ? `마지막 사용 ${formatDateTime(status.lastUsedAt)}` : '아직 사용 기록 없음'}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <button type="button" onClick={() => void issue()} disabled={busy} className="btn-secondary text-sm min-h-[48px] flex items-center gap-2">
                                {busy && <div className="w-3.5 h-3.5 spinner" />}
                                새 키로 교체
                            </button>
                            <button
                                type="button"
                                onClick={() => void revoke()}
                                disabled={busy}
                                className="ml-auto text-sm font-medium text-red-500 dark:text-red-400 px-4 min-h-[48px] rounded-xl border border-surface-200 dark:border-surface-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
                            >
                                키 폐기
                            </button>
                        </div>
                    </div>
                ) : (
                    <button type="button" onClick={() => void issue()} disabled={busy} className="btn-primary w-full min-h-[48px] flex items-center justify-center gap-2">
                        {busy && <div className="w-4 h-4 spinner" />}
                        API 키 발급
                    </button>
                )}

                {/* 사용법 */}
                <details className="rounded-xl border border-dashed border-surface-200 dark:border-surface-600 p-3.5 text-xs text-surface-600 dark:text-surface-400">
                    <summary className="cursor-pointer font-semibold text-surface-700 dark:text-surface-300 min-h-[32px] flex items-center">
                        사용 방법 · 응답 예시 · 구글 앱스 스크립트 예제
                    </summary>
                    <div className="mt-3 space-y-3 leading-relaxed">
                        <ul className="list-disc pl-5 space-y-1">
                            <li>요청 헤더에 <code className="font-mono">Authorization: Bearer &lt;API 키&gt;</code>를 넣어 GET으로 부릅니다.</li>
                            <li>운행 중인 차량만 나옵니다(퇴역 차량 제외). 하이패스가 연결되지 않은 차량은 잔액이 <code className="font-mono">null</code>입니다.</li>
                            <li>기관당 <strong>시간당 60회</strong>까지 부를 수 있습니다. 값은 운행일지·하이패스 기록이 저장될 때 바뀌므로 1시간에 한 번 정도면 충분합니다.</li>
                            <li>키는 웹 페이지나 공유 문서에 적지 마세요. 키가 새었다고 생각되면 <strong>새 키로 교체</strong>하면 이전 키는 바로 막힙니다.</li>
                            <li>설정 › 기능 사용에서 [외부 연동(API)]을 끄면 키가 있어도 조회가 막힙니다.</li>
                        </ul>
                        <div>
                            <p className="font-medium text-surface-700 dark:text-surface-300 mb-1">응답 예시</p>
                            <pre className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 overflow-x-auto text-[11px] text-surface-800 dark:text-surface-200">{responseExample}</pre>
                        </div>
                        <div>
                            <p className="font-medium text-surface-700 dark:text-surface-300 mb-1">구글 앱스 스크립트 예제</p>
                            <pre className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 overflow-x-auto text-[11px] text-surface-800 dark:text-surface-200">{scriptExample}</pre>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
}
