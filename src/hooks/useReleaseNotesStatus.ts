/**
 * useReleaseNotesStatus — 업데이트 소식 '새 소식' 배지 상태
 *
 * 최신 릴리즈 날짜와 localStorage에 저장된 '마지막으로 본 날짜'를 비교해
 * 아직 확인하지 않은 새 소식이 있는지(hasNew) 알려준다.
 * markSeen()을 호출하면 최신 날짜를 저장하고, 앱 내 모든 사용처의 배지를 즉시 끈다.
 */
import { useState, useEffect, useCallback } from 'react';
import { loadReleaseNotes, releaseSignature, hasUnseenRelease } from '../lib/releaseNotes';

const LAST_SEEN_KEY = 'releaseNotes_lastSeen';
const SEEN_EVENT = 'releaseNotesSeen';

export default function useReleaseNotesStatus() {
    const [latestDate, setLatestDate] = useState<string | null>(null);
    // 배지를 끌 때 저장할 값. 화면에 보여 주는 latestDate와 달리 그날 공지 내용의 지문까지 담는다.
    const [seenKey, setSeenKey] = useState<string | null>(null);
    const [hasNew, setHasNew] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadReleaseNotes()
            .then((notes) => {
                if (cancelled || notes.length === 0) return;
                // 날짜 형식은 YYYY-MM-DD라 문자열 비교로 최신 판별 가능
                const latest = notes.reduce((max, n) => (n.date > max ? n.date : max), notes[0].date);
                // 서명에는 그날 공지 내용의 지문까지 담는다 — 같은 날 덧붙이거나 다시 쓴 공지도 배지를 띄운다
                // (판정 규칙은 releaseNotes.ts의 releaseSignature · hasUnseenRelease)
                const signature = releaseSignature(notes)!;
                setLatestDate(latest);
                setSeenKey(signature);
                let lastSeen: string | null = null;
                try { lastSeen = localStorage.getItem(LAST_SEEN_KEY); } catch { /* localStorage 불가 환경 무시 */ }
                setHasNew(hasUnseenRelease(lastSeen, signature));
            })
            .catch(() => { /* 로드 실패 시 배지 표시 안 함 */ });
        return () => { cancelled = true; };
    }, []);

    // 다른 컴포넌트(다른 훅 인스턴스)에서 markSeen이 불리면 배지를 함께 끈다
    useEffect(() => {
        const handler = () => setHasNew(false);
        window.addEventListener(SEEN_EVENT, handler);
        return () => window.removeEventListener(SEEN_EVENT, handler);
    }, []);

    const markSeen = useCallback(() => {
        if (!seenKey) return;
        try { localStorage.setItem(LAST_SEEN_KEY, seenKey); } catch { /* 무시 */ }
        setHasNew(false);
        window.dispatchEvent(new Event(SEEN_EVENT));
    }, [seenKey]);

    return { hasNew, latestDate, markSeen };
}
