/**
 * useDriveLogOcr — 계기판 OCR 촬영/인식 로직
 * useDriveLogForm에서 분리된 서브 훅
 */
import { useState, useRef, useCallback } from 'react';
import { ocrDashboard } from '../lib/ocr';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { createFeedback } from '../lib/firestore';

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
            // 이미지를 Canvas로 리사이즈(최대 512px) + JPEG 압축 후 base64 변환
            const base64 = await new Promise((resolve, reject) => {
                const img = new Image();
                const objectUrl = URL.createObjectURL(file);
                img.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    const MAX = 1024;
                    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.80));
                };
                img.onerror = reject;
                img.src = objectUrl;
            });

            // "data:image/jpeg;base64," 접두사 처리
            const base64Data = (base64 as string).split(',')[1];
            setOcrImageUrl(base64 as string);

            const result = await ocrDashboard(base64Data, 'image/jpeg', isElectric) as { km: number | null; battery: number | null; raw: string };

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
                const storageRef = ref(storage, `feedbacks/ocr-report/${user?.uid || 'unknown'}/${timestamp}.jpg`);

                // 이미지 압축 (1200px)
                const compressed = await new Promise((resolve) => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const img = new Image();
                    img.onload = () => {
                        const maxSize = 1200;
                        let { width, height } = img;
                        if (width > height && width > maxSize) {
                            height = (height * maxSize) / width;
                            width = maxSize;
                        } else if (height > maxSize) {
                            width = (width * maxSize) / height;
                            height = maxSize;
                        }
                        canvas.width = width;
                        canvas.height = height;
                        ctx!.drawImage(img, 0, 0, width, height);
                        canvas.toBlob(resolve, 'image/jpeg', 0.7);
                    };
                    img.src = URL.createObjectURL(ocrData.imageFile);
                });

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
