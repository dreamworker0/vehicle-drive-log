/**
 * useOrgApplication — 기관 사용 신청 폼 로직 훅
 * 폼 상태, 파일 처리(검증/압축/드래그), 제출(익명로그인+업로드+OCR) 관리
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createOrganization, updateOrganization } from '../lib/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth as firebaseAuth } from '../lib/firebase';
import { signInAnonymously } from 'firebase/auth';
import { logout } from '../lib/auth';

// 허용 파일 타입
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 이미지 압축 (최대 1200px, JPEG 70%)
 */
function compressImage(file: File) {
    return new Promise((resolve) => {
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
        img.src = URL.createObjectURL(file);
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

    // 비인증 상태일 때 익명 로그인 (Storage 보안 규칙 인증 체크용)
    useEffect(() => {
        if (!firebaseAuth.currentUser) {
            signInAnonymously(firebaseAuth).catch((err) => {
                console.warn('익명 로그인 실패:', err.message);
            });
        }
        return () => {
            if (firebaseAuth.currentUser?.isAnonymous) {
                logout().catch(() => { });
            }
        };
    }, []);

    // 폼 상태
    const [form, setForm] = useState({
        applicantName: currentUser?.displayName || '',
        orgName: '',
        applicantEmail: currentUser?.email || '',
        applicantPhone: '',
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
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
        if (!imageFile) {
            setError('비영리 증빙서류를 업로드해주세요.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // 인증 상태 확인
            if (!firebaseAuth.currentUser) {
                try {
                    await signInAnonymously(firebaseAuth);
                } catch (authErr) {
                    console.error('익명 로그인 실패:', authErr);
                    setError('인증에 실패했습니다. 페이지를 새로고침 후 다시 시도해주세요.');
                    setLoading(false);
                    return;
                }
            }

            // 1. 기관 신청 생성
            setOcrStatus('uploading');
            const orgId = await createOrganization({
                name: form.orgName,
                applicantName: form.applicantName,
                applicantEmail: form.applicantEmail,
                applicantPhone: form.applicantPhone,
                applicantUid: firebaseAuth.currentUser?.uid || '',
                aiVerified: false,
                uniqueNumberImageUrl: '',
            });

            // 2. 파일 업로드
            let fileToUpload: File | Blob = imageFile;
            let finalMimeType = imageFile.type;

            if (imageFile.type.startsWith('image/')) {
                setOcrStatus('uploading');
                fileToUpload = await compressImage(imageFile) as Blob;
                finalMimeType = 'image/jpeg';
            }

            const fileExt = finalMimeType === 'application/pdf' ? 'pdf' : 'jpg';
            const storageRef = ref(storage, `organizations/${orgId}/uniqueNumberImage.${fileExt}`);
            await uploadBytes(storageRef, fileToUpload, { contentType: finalMimeType });
            const imageUrl = await getDownloadURL(storageRef);

            // 3. 이미지 URL 저장 → AI 분석 트리거
            setOcrStatus('analyzing');
            await updateOrganization(orgId, { uniqueNumberImageUrl: imageUrl });

            setOcrStatus('done');
            setSuccess(true);
        } catch (err) {
            setError('신청 중 오류가 발생했습니다. 다시 시도해주세요.');
            console.error(err);
        } finally {
            setLoading(false);
            setOcrStatus('');
        }
    }, [form, imageFile]);

    // 뒤로가기 (익명 세션 정리)
    const handleGoBack = useCallback(async (navigate: (path: string) => void) => {
        if (firebaseAuth.currentUser?.isAnonymous) {
            await logout();
        }
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
