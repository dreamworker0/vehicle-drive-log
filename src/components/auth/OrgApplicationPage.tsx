import { useNavigate } from 'react-router-dom';
import useForceLightMode from '../../hooks/useForceLightMode';
import useOrgApplication from '../../hooks/useOrgApplication';
import SEOHead from '../common/SEOHead';

export default function OrgApplicationPage() {
    useForceLightMode();
    const navigate = useNavigate();

    const {
        form, imageFile, imagePreview, loading, ocrStatus,
        error, isDragging, success, agreeTerms, agreePrivacy,
        fileInputRef, currentUser,
        setAgreeTerms, setAgreePrivacy,
        handleChange, handlePhoneChange, handleImageChange,
        handleDragOver, handleDragLeave, handleDrop,
        handleSubmit, handleGoBack,
    } = useOrgApplication();

    // ─── 성공 화면 ───
    if (success) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-surface-50 to-accent-50 dark:from-surface-950 dark:to-surface-900 px-4">
                <div className="w-full max-w-sm text-center animate-scale-in">
                    <div className="w-20 h-20 mx-auto mb-6 bg-accent-100 rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-accent-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">신청이 접수되었습니다!</h2>
                    <p className="text-surface-500 dark:text-surface-400 mb-6">
                        AI가 서류를 검증 중입니다.
                        <br />승인되면 <strong className="text-surface-700 dark:text-surface-300">{form.applicantEmail}</strong>와 카톡으로
                        <br /><strong className="text-primary-600">앱 링크와 초대 코드</strong>가 발송됩니다.
                        <br /><br />
                        <span className="text-xs">보통 1분 이내에 처리되며, 보류 시 영업일 기준 1~2일 내에 처리됩니다.</span>
                    </p>
                    <button onClick={() => handleGoBack(navigate)} className="btn-primary">
                        확인
                    </button>
                </div>
            </div>
        );
    }

    // ─── 신청 폼 ───
    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 dark:from-surface-950 dark:to-surface-900 py-8 px-4">
            <SEOHead
                title="기관 사용 신청"
                description="사회복지기관·비영리단체라면 무료로 차량 운행일지 서비스를 신청하세요."
                path="/apply"
            />
            <div className="w-full max-w-lg mx-auto animate-fade-in">
                {/* 뒤로가기 */}
                <button
                    type="button"
                    onClick={() => handleGoBack(navigate)}
                    className="flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-4 transition-colors"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                    돌아가기
                </button>
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">기관 사용 신청</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400">차량 운행일지 서비스를 시작하세요</p>
                </div>

                <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
                    {/* 안내 사항 */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-200">
                        <p className="font-semibold mb-1">📌 신청 전 확인해주세요</p>
                        <ul className="list-disc list-inside space-y-0.5">
                            <li>본 서비스는 <strong>사회복지기관, 비영리단체</strong>를 대상으로 <strong>무료</strong>로 제공됩니다.</li>
                            <li>영리 기업 및 종교단체, 학교, 병원은 신청이 <strong>반려</strong>될 수 있습니다.</li>
                        </ul>
                    </div>

                    {/* 신청자 정보 */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wider">신청자 정보</h3>
                        <div>
                            <label className="label">이름 <span className="text-red-500">*</span></label>
                            <input
                                type="text" name="applicantName" value={form.applicantName}
                                onChange={handleChange}
                                className={`input ${currentUser?.displayName ? 'bg-surface-50 dark:bg-surface-800 text-surface-500' : ''}`}
                                readOnly={!!currentUser?.displayName}
                                placeholder="홍길동" required
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="label">이메일 <span className="text-red-500">*</span></label>
                            <input
                                type="email" name="applicantEmail" value={form.applicantEmail}
                                onChange={handleChange} className={`input ${currentUser?.email ? 'bg-surface-50 dark:bg-surface-800' : ''}`} readOnly={!!currentUser?.email}
                                placeholder="example@email.com" required
                            />
                        </div>
                        <div>
                            <label className="label">전화번호</label>
                            <input
                                type="tel" name="applicantPhone" value={form.applicantPhone}
                                onChange={handlePhoneChange} className="input" placeholder="010-0000-0000"
                            />
                        </div>
                    </div>

                    <hr className="border-surface-100 dark:border-surface-700" />

                    {/* 기관 정보 */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wider">기관 정보</h3>
                        <div>
                            <label className="label">기관명 <span className="text-red-500">*</span></label>
                            <input
                                type="text" name="orgName" value={form.orgName}
                                onChange={handleChange} className="input" placeholder="○○복지관" required
                            />
                        </div>

                        <div>
                            <label className="label">비영리 증빙서류 (고유번호증 또는 사업자등록증) <span className="text-red-500">*</span></label>
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${isDragging
                                    ? 'border-primary-400 bg-primary-50/50 dark:bg-primary-900/20 scale-[1.02]'
                                    : imagePreview
                                        ? 'border-accent-300 bg-accent-50/50 dark:border-accent-700 dark:bg-accent-900/20'
                                        : 'border-surface-200 dark:border-surface-600 hover:border-primary-300 hover:bg-primary-50/30'
                                    }`}
                            >
                                {imagePreview ? (
                                    <div className="space-y-2">
                                        {imageFile?.type === 'application/pdf' ? (
                                            <div className="py-4">
                                                <svg className="w-16 h-16 mx-auto text-red-500 mb-2" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-2.5 5.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zm5 1.5c-.55 0-1.04-.22-1.4-.57l-.1.07c0 .55-.45 1-1 1H12v-4h1c.55 0 1 .45 1 1l.1.07c.36-.35.85-.57 1.4-.57.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
                                                </svg>
                                                <p className="text-sm font-medium text-surface-700 dark:text-surface-200">{imageFile.name}</p>
                                                <p className="text-xs text-surface-500">PDF 문서가 선택되었습니다</p>
                                            </div>
                                        ) : (
                                            <img src={imagePreview} alt="미리보기" className="max-h-40 mx-auto rounded-lg" />
                                        )}
                                        <p className="text-xs text-surface-500 dark:text-surface-400">다시 선택하려면 클릭 또는 드래그하세요</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <svg className={`w-10 h-10 mx-auto transition-colors ${isDragging ? 'text-primary-400' : 'text-surface-300'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v13.5A1.5 1.5 0 0 0 3.75 21z" />
                                        </svg>
                                        <p className="text-sm text-surface-500 dark:text-surface-400">{isDragging ? '여기에 놓으세요!' : '클릭 또는 드래그하여 업로드'}</p>
                                        <p className="text-xs text-surface-400">JPG, PNG, PDF (5MB 이하)</p>
                                    </div>
                                )}
                            </div>
                            <input
                                ref={fileInputRef}
                                id="nonprofit-document-upload"
                                aria-label="비영리 증빙서류 업로드"
                                type="file"
                                accept="image/jpeg,image/png,application/pdf"
                                onChange={handleImageChange}
                                className="hidden"
                            />
                            <p className="text-xs text-surface-400 dark:text-surface-500 mt-2">
                                ※ 사회복지시설신고증은 증빙서류로 인정되지 않습니다. 고유번호증 또는 사업자등록증을 업로드해주세요.
                            </p>
                        </div>

                        <div>
                            <label className="label">하고 싶은 말</label>
                            <textarea
                                name="message"
                                value={form.message}
                                onChange={handleChange}
                                className="input min-h-[80px] resize-y"
                                placeholder="전달하고 싶은 내용이 있으면 자유롭게 적어주세요."
                                maxLength={500}
                                rows={3}
                            />
                            <p className="text-xs text-surface-400 dark:text-surface-500 mt-1 text-right">
                                {form.message.length}/500
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:border-red-700/40 dark:text-red-300 animate-slide-down">
                            {error}
                        </div>
                    )}

                    {/* 약관 동의 */}
                    <div className="space-y-3 bg-surface-50 dark:bg-surface-800 rounded-xl p-4">
                        <label htmlFor="agree-terms" className="flex items-start gap-3 cursor-pointer group">
                            <input
                                id="agree-terms"
                                type="checkbox"
                                checked={agreeTerms}
                                onChange={(e) => setAgreeTerms(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-sm text-surface-600 dark:text-surface-400 group-hover:text-surface-800 dark:text-surface-200 transition-colors">
                                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary-600 underline underline-offset-2 font-medium hover:text-primary-700">이용약관</a>에 동의합니다. <span className="text-red-500">*</span>
                            </span>
                        </label>
                        <label htmlFor="agree-privacy" className="flex items-start gap-3 cursor-pointer group">
                            <input
                                id="agree-privacy"
                                type="checkbox"
                                checked={agreePrivacy}
                                onChange={(e) => setAgreePrivacy(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-sm text-surface-600 dark:text-surface-400 group-hover:text-surface-800 dark:text-surface-200 transition-colors">
                                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary-600 underline underline-offset-2 font-medium hover:text-primary-700">개인정보 처리방침</a>에 동의합니다. <span className="text-red-500">*</span>
                            </span>
                        </label>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => handleGoBack(navigate)}
                            className="btn-secondary flex-1"
                        >
                            취소
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !agreeTerms || !agreePrivacy}
                            className="btn-primary flex-1"
                        >
                            {loading ? (
                                <div className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 spinner" />
                                    {ocrStatus === 'uploading' && '이미지 업로드 중...'}
                                    {ocrStatus === 'analyzing' && 'AI가 문서를 분석 중...'}
                                    {ocrStatus === 'done' && '등록 중...'}
                                    {!ocrStatus && '신청 중...'}
                                </div>
                            ) : '신청하기'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
