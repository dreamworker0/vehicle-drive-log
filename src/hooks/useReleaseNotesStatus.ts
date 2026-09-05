/**
 * useReleaseNotesStatus — 업데이트 소식 '새 소식' 배지 상태
 *
 * 최신 릴리즈 날짜와 localStorage에 저장된 '마지막으로 본 날짜'를 비교해
 * 아직 확인하지 않은 새 소식이 있는지(hasNew) 알려준다.
 * markSeen()을 호출하면 최신 날짜를 저장하고, 앱 내 모든 사용처의 배지를 즉시 끈다.
 */
import { useState, useEffect, useCallback } from 'react';
import { loadReleaseNotes } from '../lib/releaseNotes';

const LAST_SEEN_KEY = 'releaseNotes_lastSeen';
const SEEN_EVENT = 'releaseNotesSeen';

export default function useReleaseNotesStatus() {
    const [latestDate, setLatestDate] = useState<string | null>(null);
    // 배지를 끌 때 저장할 값. 화면에 보여 주는 latestDate와 달리 공지 수까지 담는다.
    const [seenKey, setSeenKey] = useState<string | null>(null);
    const [hasNew, setHasNew] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadReleaseNotes()
            .then((notes) => {
                if (cancelled || notes.length === 0) return;
                // 날짜 형식은 YYYY-MM-DD라 문자열 비교로 최신 판별 가능
                const latest = notes.reduce((max, n) => (n.date > max ? n.date : max), notes[0].date);
                // 배지 판정에는 **날짜 + 공지 수**를 쓴다. 날짜만 보면 같은 날 두 번째로 나가는
                // 공지가 배지를 못 띄운다 — 오전 공지를 이미 열어 본 사람은 lastSeen이 그날
                // 날짜라 `lastSeen < latest`가 거짓이 된다. 공지 수는 늘기만 하므로 같은 날
                // 새 공지가 붙으면 서명이 달라진다. 자리수를 채우는 이유는 99 → 100에서
                // '9' > '1'이라 늘어난 쪽이 더 작아지는 것을 막기 위해서다.
                const signature = `${latest}#${String(notes.length).padStart(4, '0')}`;
                setLatestDate(latest);
                setSeenKey(signature);
                let lastSeen: string | null = null;
                try { lastSeen = localStorage.getItem(LAST_SEEN_KEY); } catch { /* localStorage 불가 환경 무시 */ }
                // 이전 형식(날짜만)으로 저장된 값도 그대로 받는다 — 날짜가 같으면 '#'이 없는
                // 쪽이 항상 작아 배지가 한 번 더 뜬다. 놓치는 것보다 낫다.
                setHasNew(!lastSeen || lastSeen < signature);
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
