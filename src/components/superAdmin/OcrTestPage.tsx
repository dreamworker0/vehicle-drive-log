import { useState, useRef } from 'react';
import { ocrDashboard } from '../../lib/ocr';

interface OcrHistoryItem {
    id: number;
    thumbnail: string | null;
    km: number | null;
    battery: number | null;
    raw: string | null;
    elapsed: string;
    isElectric: boolean;
    timestamp: string;
    success: boolean;
}

export default function OcrTestPage() {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState('image/jpeg');
    const [isElectric, setIsElectric] = useState(false);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState<OcrHistoryItem[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = (file: File | undefined) => {
        if (!file || !file.type.startsWith('image/')) return;
        setMimeType('image/jpeg'); // 리사이즈 후 항상 JPEG
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            // 실제 앱(useDriveLogOcr)과 동일한 리사이즈 + 압축
            const MAX = 1024;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
            setImagePreview(dataUrl);
            setImageBase64(dataUrl.split(',')[1]);
        };
        img.onerror = () => URL.revokeObjectURL(objectUrl);
        img.src = objectUrl;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFile(e.target.files?.[0]);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files?.[0]);
    };

    const handleAnalyze = async () => {
        if (!imageBase64 || loading) return;
        setLoading(true);
        const startTime = Date.now();
        try {
            const result = await ocrDashboard(imageBase64, mimeType, isElectric) as Record<string, unknown>;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            setHistory(prev => [{
                id: Date.now(),
                thumbnail: imagePreview,
                km: result.km as number | null,
                battery: result.battery as number | null,
                raw: result.raw as string | null,
                elapsed,
                isElectric,
                timestamp: new Date().toLocaleTimeString('ko-KR'),
                success: true,
            }, ...prev]);
        } catch (err) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            setHistory(prev => [{
                id: Date.now(),
                thumbnail: imagePreview,
                km: null,
                battery: null,
                raw: (err as Error).message,
                elapsed,
                isElectric,
                timestamp: new Date().toLocaleTimeString('ko-KR'),
                success: false,
            }, ...prev]);
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setImagePreview(null);
        setImageBase64(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="animate-fade-in max-w-4xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">계기판 OCR 테스트</h1>
                <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
                    계기판 사진을 업로드하고 Gemini AI가 누적 km를 정확히 인식하는지 테스트합니다.
                </p>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                    모델: <code className="px-1.5 py-0.5 bg-surface-100 dark:bg-surface-800 rounded text-[11px]">gemini-2.5-flash</code>
                </p>
            </div>

            {/* 이미지 업로드 영역 */}
            <div className="glass-card p-5 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300">이미지 업로드</h2>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className="text-xs text-surface-500 dark:text-surface-400">전기차</span>
                        <button
                            type="button"
                            onClick={() => setIsElectric(!isElectric)}
                            className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-300 focus:outline-none ${isElectric ? 'bg-emerald-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ${isElectric ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                    </label>
                </div>

                {!imagePreview ? (
                    <div
                        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver
                            ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-surface-200 dark:border-surface-700 hover:border-primary-300 hover:bg-surface-50 dark:hover:bg-surface-800/50'
                            }`}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                    >
                        <svg className="w-12 h-12 mx-auto text-surface-300 dark:text-surface-600 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 0 0 1.5-1.5V5.25a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5Z" />
                        </svg>
                        <p className="text-sm text-surface-500 dark:text-surface-400">
                            클릭하거나 이미지를 드래그하세요
                        </p>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                            JPG, PNG, HEIC 지원
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="relative rounded-xl overflow-hidden bg-black/5 dark:bg-black/20">
                            <img
                                src={imagePreview}
                                alt="계기판 미리보기"
                                className="w-full max-h-80 object-contain"
                            />
                            <button
                                onClick={handleClear}
                                className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <button
                            onClick={handleAnalyze}
                            disabled={loading}
                            className="w-full btn-primary py-3 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    분석 중...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                    </svg>
                                    AI 분석 시작
                                </>
                            )}
                        </button>
                    </div>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>

            {/* 테스트 히스토리 */}
            {history.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300">
                            테스트 결과 ({history.length}건)
                        </h2>
                        <button
                            onClick={() => setHistory([])}
                            className="text-xs text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                            전체 삭제
                        </button>
                    </div>

                    {history.map((item) => (
                        <div
                            key={item.id}
                            className={`glass-card overflow-hidden ${!item.success ? 'ring-1 ring-red-200 dark:ring-red-800' : ''
                                }`}
                        >
                            <div className="flex gap-4 p-4">
                                {/* 썸네일 */}
                                <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-black/5 dark:bg-black/20">
                                    <img
                                        src={item.thumbnail || undefined}
                                        alt="계기판"
                                        className="w-full h-full object-cover"
                                    />
                                </div>

                                {/* 결과 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex items-center gap-2">
                                            {item.success ? (
                                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                                                    ✓ 성공
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
                                                    ✗ 실패
                                                </span>
                                            )}
                                            {item.isElectric && (
                                                <span className="text-xs text-emerald-500 dark:text-emerald-400">⚡ 전기차</span>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-surface-400 whitespace-nowrap">
                                            {item.timestamp} · {item.elapsed}s
                                        </span>
                                    </div>

                                    {item.success ? (
                                        <div className="space-y-1.5">
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-xs text-surface-500 dark:text-surface-400 w-16">누적 km</span>
                                                <span className={`text-lg font-bold ${item.km != null
                                                    ? 'text-surface-900 dark:text-surface-100'
                                                    : 'text-red-400'
                                                    }`}>
                                                    {item.km != null
                                                        ? `${item.km.toLocaleString()} km`
                                                        : '인식 실패'}
                                                </span>
                                            </div>
                                            {item.isElectric && (
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-xs text-surface-500 dark:text-surface-400 w-16">배터리</span>
                                                    <span className={`text-sm font-semibold ${item.battery != null
                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                        : 'text-red-400'
                                                        }`}>
                                                        {item.battery != null
                                                            ? `${item.battery}%`
                                                            : '인식 실패'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-red-500">{item.raw}</p>
                                    )}
                                </div>
                            </div>

                            {/* AI Raw 응답 (접기) */}
                            {item.success && item.raw && (
                                <details className="border-t border-surface-100 dark:border-surface-700">
                                    <summary className="px-4 py-2 text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 cursor-pointer select-none transition-colors">
                                        AI 원본 응답 보기
                                    </summary>
                                    <div className="px-4 pb-3">
                                        <pre className="text-xs text-surface-600 dark:text-surface-400 bg-surface-50 dark:bg-surface-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                                            {item.raw}
                                        </pre>
                                    </div>
                                </details>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
