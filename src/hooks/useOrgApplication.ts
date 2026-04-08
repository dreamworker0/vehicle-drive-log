/**
 * useOrgApplication — 기관 사용 신청 폼 로직 훅
 * 폼 상태, 파일 처리(검증/압축/드래그), 제출(익명로그인+업로드+OCR) 관리
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { auth as firebaseAuth, firebaseFunctions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import imageCompression from 'browser-image-compression';

// 허용 파일 타입
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 이미지 압축 (최대 1200px, JPEG)
 */
async function compressImage(file: File): Promise<File> {
    try {
        return await imageCompression(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 1200,
            useWebWorker: true,
            fileType: 'image/jpeg'
        });
    } catch (e) {
        console.error('이미지 압축 실패, 원본 반환:', e);
        return file;
    }
}

/**
 * File을 Base64 문자열로 변환 (data: MIME;base64, 포맷)
 */
async function fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('파일 읽기 실패(결과가 문자열이 아님)'));
            }
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * 전화번호 포맷팅 (000-0000-0000)
 */
export function formatPhoneNumber(value: string) {
    const nums = value.replace(/[^0-9]/g, '').slice(0, 11);
    if (nums.length <= 3) return nums;
    if (nums.length <= 7) return `${nums.slice(0, 3)}-${nums.slice(3)}`;
    return `${nums.slice(0, 3)}-${nums.slice(3, 7)}-${nums.slice(7)}`;
}

export default function useOrgApplication() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const currentUser = firebaseAuth.currentUser;

    // 폼 상태
    const [form, setForm] = useState({
        applicantName: currentUser?.displayName || '',
        orgName: '',
        applicantEmail: currentUser?.email || '',
        applicantPhone: '',
        message: '',
    });
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [ocrStatus, setOcrStatus] = useState(''); // '' | 'uploading' | 'analyzing' | 'done'
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [success, setSuccess] = useState(false);
    const [agreeTerms, setAgreeTerms] = useState(false);
    const [agreePrivacy, setAgreePrivacy] = useState(false);

    // 폼 입력 핸들러
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    }, []);

    const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatPhoneNumber(e.target.value);
        setForm(prev => ({ ...prev, applicantPhone: formatted }));
    }, []);

    // 파일 검증 및 설정
    const processFile = useCallback((file: File | undefined) => {
        if (!file) return;
        if (!ALLOWED_TYPES.includes(file.type)) {
            setError('JPG, PNG 이미지 또는 PDF 파일만 업로드 가능합니다.');
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            setError('파일 크기는 5MB 이하여야 합니다.');
            return;
        }
        setError('');
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
    }, []);

    const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        processFile(e.target.files?.[0]);
    }, [processFile]);

    // 드래그 앤 드롭
    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        processFile(e.dataTransfer.files[0]);
    }, [processFile]);

    // 제출
    const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!form.orgName || !form.applicantName || !form.applicantEmail) {
            setError('필수 항목을 모두 입력해주세요.');
            return;
        }

        // 종교단체·학교·병원 신청 차단
        const BLOCKED_CATEGORIES = [
            { category: '종교단체', keywords: ['교회', '사찰', '성당', '수도원', '선교'] },
            { category: '학교', keywords: ['학교', '초등학교', '중학교', '고등학교', '대학교', '유치원', '어린이집'] },
            { category: '병원', keywords: ['병원', '의원', '한의원', '치과', '클리닉'] },
        ];
        const blockedMatch = BLOCKED_CATEGORIES.find(cat =>
            cat.keywords.some(kw => form.orgName.includes(kw))
        );
        if (blockedMatch) {
            setError(`죄송합니다. ${blockedMatch.category}는 현재 서비스 대상이 아닙니다.`);
            return;
        }

        if (!imageFile) {
            setError('비영리 증빙서류를 업로드해주세요.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // 1. 파일 압축 및 변환
            let fileToUpload: File | Blob = imageFile;
            let finalMimeType = imageFile.type;

            if (imageFile.type.startsWith('image/')) {
                setOcrStatus('uploading');
                fileToUpload = await compressImage(imageFile) as Blob;
                finalMimeType = 'image/jpeg';
            }

            const base64Data = await fileToBase64(fileToUpload);

            // 2. Cloud Functions Callable 호출 (기관 생성 + Storage 업로드)
            setOcrStatus('uploading');
            const submitAppFn = httpsCallable(firebaseFunctions, 'submitOrgApplication');
            
            await submitAppFn({
                orgName: form.orgName.trim(),
                applicantName: form.applicantName.trim(),
                applicantEmail: form.applicantEmail.trim(),
                applicantPhone: form.applicantPhone.trim(),
                message: form.message.trim(),
                imageBase64: base64Data,
                imageMimeType: finalMimeType,
            });

            // 완료
            setOcrStatus('done');
            setSuccess(true);
        } catch (err: unknown) {
            const errorMsg = (err as Error).message;
            if (errorMsg.includes('resource-exhausted') || errorMsg.includes('요청이 너무 많습니다')) {
                setError('요청 횟수를 초과했습니다. 나중에 다시 시도해주세요.');
            } else {
                setError('신청 중 오류가 발생했습니다. 다시 시도해주세요.');
            }
            console.error(err);
        } finally {
            setLoading(false);
            setOcrStatus('');
        }
    }, [form, imageFile]);

    const handleGoBack = useCallback(async (navigate: (path: string) => void) => {
        navigate('/');
    }, []);

    return {
        // 상태
        form, imageFile, imagePreview, loading, ocrStatus,
        error, isDragging, success, agreeTerms, agreePrivacy,
        fileInputRef, currentUser,
        // 세터
        setAgreeTerms, setAgreePrivacy,
        // 핸들러
        handleChange, handlePhoneChange, handleImageChange,
        handleDragOver, handleDragLeave, handleDrop,
        handleSubmit, handleGoBack,
    };
}
