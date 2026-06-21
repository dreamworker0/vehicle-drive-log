/**
 * useSettingsModals — Settings 페이지의 모달 표시 상태 묶음
 * 건의/사용설명서/AI 채팅/서비스 해지 모달의 on/off 상태만 관리하는 순수 UI 훅.
 */
import { useState } from 'react';

export default function useSettingsModals() {
    const [showFeedback, setShowFeedback] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const [showAskAI, setShowAskAI] = useState(false);
    const [showWithdraw, setShowWithdraw] = useState(false);

    return {
        showFeedback, setShowFeedback,
        showManual, setShowManual,
        showAskAI, setShowAskAI,
        showWithdraw, setShowWithdraw,
    };
}
