/**
 * useDriveLogOcr — 계기판 OCR 촬영/인식 로직
 * useDriveLogForm에서 분리된 서브 훅
 */
import { useState, useRef, useCallback } from 'react';
import { ocrDashboard } from '../lib/ocr';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { createFeedback } from '../lib/firestore';
import imageCompression from 'browser-image-compression';

import type { DriveLogForm } from './useDriveLogForm';
import type { User as FirebaseUser } from 'firebase/auth';

interface OcrProps {
    isElectric: boolean;
    setForm: React.Dispatch<React.SetStateAction<DriveLogForm>>;
    user: FirebaseUser | null;
    userData: { name?: string; organizationId?: string | null } | null;
    vehicleName: string;
}

interface OcrResult {
    imageFile: File;
    recognizedKm: number | null;
    recognizedBattery: number | null;
    raw: string;
    isElectric: boolean;
}

export default function useDriveLogOcr({ isElectric, setForm, user, userData, vehicleName }: OcrProps) {
    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrError, setOcrError] = useState('');
    const [ocrSuccess, setOcrSuccess] = useState(false);
    const [ocrReportSending, setOcrReportSending] = useState(false);
    const [ocrReportSent, setOcrReportSent] = useState(false);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const endKmInputRef = useRef<HTMLInputElement>(null);

    const [ocrImageUrl, setOcrImageUrl] = useState<string | null>(null);

    // 마지막 OCR 결과를 저장 (오류 신고 시 사용)
    const lastOcrRef = useRef<OcrResult | null>(null);

    const handleOcrCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setOcrLoading(true);
        setOcrError('');
        setOcrSuccess(false);
        setOcrReportSent(false);
        setOcrImageUrl(null);

        try {
            // browser-image-compression을 통해 WebWorker 기반 리사이즈 및 WebP 변환
            const compressedFile = await imageCompression(file, {
                maxSizeMB: 0.5,
                maxWidthOrHeight: 1024,
                useWebWorker: true,
                fileType: 'image/webp'
            });
            
            const base64 = await imageCompression.getDataUrlFromFile(compressedFile);

            // "data:image/webp;base64," 접두사 처리
            const base64Data = base64.split(',')[1];
            setOcrImageUrl(base64);

            // OCR AI 서버에는 가급적 jpeg(또는 컨텍스트에 맞게) 전송하지만 OpenAI는 webp와 base64 모두 지원.
            // mime-type 매개변수에 맞춰서 그대로 호출
            const result = await ocrDashboard(base64Data, 'image/webp', isElectric) as { km: number | null; battery: number | null; raw: string };

            // 신고용으로 원본 이미지 + 결과 저장
            lastOcrRef.current = {
                imageFile: file,
                recognizedKm: result.km,
                recognizedBattery: result.battery,
                raw: result.raw,
                isElectric,
            };

            if (result.km != null) {
                setForm(prev => ({
                    ...prev,
                    endKm: result.km!.toString(),
                    ...(isElectric && result.battery != null ? { batteryEnd: result.battery.toString() } : {}),
                }));
                setOcrSuccess(true);
            } else {
                setOcrError('계기판에서 숫자를 인식하지 못했습니다. 직접 입력해주세요.');
            }
        } catch (err) {
            console.error('계기판 OCR 실패:', err);
            setOcrError('계기판 인식에 실패했습니다. 사진이 흐릿하지 않은지 확인 후 직접 입력해주세요.');
            setTimeout(() => endKmInputRef.current?.focus(), 300);
        } finally {
            setOcrLoading(false);
            // input 초기화 (같은 파일 재선택 가능)
            if (cameraInputRef.current) cameraInputRef.current.value = '';
        }
    };

    // 인식 오류 보내기
    const handleOcrReport = useCallback(async () => {
        const ocrData = lastOcrRef.current;
        if (!ocrData || ocrReportSending) return;

        setOcrReportSending(true);
        try {
            // 이미지를 Storage에 업로드
            const imageUrls: string[] = [];
            if (ocrData.imageFile) {
                const timestamp = Date.now();
                const storageRef = ref(storage, `feedbacks/ocr-report/${user?.uid || 'unknown'}/${timestamp}.webp`);

                // 이미지 압축 (1200px, WebP 변환)
                let compressed: File | Blob = ocrData.imageFile;
                try {
                    compressed = await imageCompression(ocrData.imageFile, {
                        maxSizeMB: 1,
                        maxWidthOrHeight: 1200,
                        useWebWorker: true,
                        fileType: 'image/webp'
                    });
                } catch (err) {
                    console.error('이미지 압축 실패, 원본 유지:', err);
                }

                await uploadBytes(storageRef, compressed as Blob);
                const url = await getDownloadURL(storageRef);
                imageUrls.push(url);
            }

            // 피드백 생성
            await createFeedback({
                message: `[계기판 OCR 인식 오류 신고]\n\n• 인식된 km: ${ocrData.recognizedKm ?? '인식 실패'}\n• 전기차 여부: ${ocrData.isElectric ? '예' : '아니오'}${ocrData.isElectric ? `\n• 인식된 배터리: ${ocrData.recognizedBattery ?? '인식 실패'}%` : ''}\n• 차량: ${vehicleName || '미선택'}\n• AI 응답: ${ocrData.raw || '없음'}`,
                imageUrls,
                userEmail: user?.email || '',
                userName: user?.displayName || userData?.name || '',
                organizationId: userData?.organizationId || '',
                type: 'ocr-error',
                authorUid: user?.uid || '',
            });

            setOcrReportSent(true);
        } catch (err) {
            console.error('OCR 오류 신고 실패:', err);
            setOcrReportSent(true);
        } finally {
            setOcrReportSending(false);
        }
    }, [ocrReportSending, user, userData, vehicleName]);

    return {
        ocrLoading, ocrError, ocrSuccess, ocrImageUrl,
        ocrReportSending, ocrReportSent,
        cameraInputRef, endKmInputRef,
        handleOcrCapture,
        handleOcrReport,
    };
}
