/**
 * releaseNotesRules — 공지 누락 감지의 판정 규칙
 *
 * 고정하는 계약: **화면이 달라진 변경만 공지 후보로 본다.**
 * 이 판정이 느슨해지면 리팩토링·테스트 커밋까지 후보로 잡혀 게이트가 소음이 되고,
 * 반대로 좁아지면 공지 없이 배포되는 것을 놓친다(실제로 다섯 건을 놓쳤다).
 */
import { describe, it, expect } from 'vitest';
import { isUserFacingPath, isAnnounceableSubject } from '../../../scripts/lib/releaseNotesRules';

describe('isAnnounceableSubject', () => {
    it('feat·fix는 공지 후보다 (scope·breaking 표기 포함)', () => {
        expect(isAnnounceableSubject('feat: 예약할 때 동승자를 미리 입력')).toBe(true);
        expect(isAnnounceableSubject('fix: 반복 예약의 시간 변경이 막혀 있던 문제')).toBe(true);
        expect(isAnnounceableSubject('fix(deps): 취약점 패치')).toBe(true);
        expect(isAnnounceableSubject('feat!: 예약 API 변경')).toBe(true);
    });

    it('chore·docs·refactor·test·ci는 후보가 아니다', () => {
        for (const s of [
            'chore: 구현이력 Phase 143 기록',
            'docs: README 오타 수정',
            'refactor: 죽은 코드 제거',
            'test: 예약 제출 테스트 추가',
            'ci: 게이트 분리',
        ]) {
            expect(isAnnounceableSubject(s)).toBe(false);
        }
    });
});

describe('isUserFacingPath', () => {
    it('화면·훅·라이브러리와 사용자에게 도달하는 서버 경로는 대상이다', () => {
        for (const p of [
            'src/components/common/ReservationSidePanel.tsx',
            'src/hooks/useReservationCalendar.ts',
            'src/lib/orgFeatures.ts',
            'src/store/themeStore.ts',
            'functions/src/handlers/callable/createReservationSafe.ts',
            'functions/src/services/reservation/createReservationCore.ts',
        ]) {
            expect(isUserFacingPath(p)).toBe(true);
        }
    });

    it('테스트·문서·하네스·설정은 대상이 아니다', () => {
        for (const p of [
            'src/__tests__/hooks/reservationSubmitActions.test.ts',
            'src/hooks/utils/reservationPassengers.test.ts',
            'functions/src/__tests__/createReservationCore.test.ts',
            'docs/구현이력.md',
            '.agent/skills/release-notes/SKILL.md',
            'scripts/check-release-notes.ts',
            'package.json',
            'firestore.rules',
        ]) {
            expect(isUserFacingPath(p)).toBe(false);
        }
    });

    it('공지 파일 자신은 대상이 아니다 (자기 변경으로 후보가 생기면 안 된다)', () => {
        expect(isUserFacingPath('public/data/releaseNotes.json')).toBe(false);
        // 같은 public 아래의 다른 산출물은 대상이다 (서비스워커·아이콘 등 사용자에게 보인다)
        expect(isUserFacingPath('public/sw.js')).toBe(true);
    });
});
