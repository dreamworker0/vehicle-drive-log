// guard-firebase-deploy 훅의 배포 커맨드 판별 로직 단위 테스트.
// 미탐(간접 배포 통과)과 오탐(일반 npm 명령 차단) 양쪽을 회귀 방지한다.
import { describe, it, expect } from 'vitest';
import { isDeployCommand } from '../guard-firebase-deploy.mjs';

describe('isDeployCommand — 직접 배포 감지', () => {
    it.each([
        'firebase deploy',
        'firebase deploy --only functions',
        'firebase.cmd deploy --only hosting',
        'npx firebase deploy',
        'npx -y firebase-tools deploy --only firestore:rules',
        'npx.cmd firebase-tools deploy',
        'cd functions; firebase deploy',
        'echo done && firebase deploy',
        'FIREBASE_TOKEN=x firebase deploy',
        'Firebase Deploy --only functions',
        // 전역 옵션·버전 지정이 사이에 낀 형태 (처음엔 놓쳤다)
        'firebase --project prod deploy',
        'firebase -P default deploy --only hosting',
        'firebase --project=prod deploy',
        'firebase --debug deploy',
        'firebase --non-interactive --project prod deploy --only functions',
        'npx firebase-tools@13 deploy',
        'npx --yes firebase-tools@latest deploy',
        'npx -y firebase-tools@13.0.1 --project prod deploy',
    ])('감지: %s', (cmd) => {
        expect(isDeployCommand(cmd)).toBe(true);
    });
});

describe('isDeployCommand — gcloud 직접 배포 감지', () => {
    it.each([
        'gcloud functions deploy onDriveLogCreated --region asia-northeast3',
        'gcloud run deploy ondrivelogcreated --image x',
        'gcloud beta functions deploy foo',
        'gcloud alpha run deploy foo',
        'gcloud --project vehicle-drive-log functions deploy foo',
        'gcloud.cmd functions deploy foo',
        'cd functions && gcloud functions deploy foo',
    ])('감지: %s', (cmd) => {
        expect(isDeployCommand(cmd)).toBe(true);
    });
});

describe('isDeployCommand — npm 스크립트 간접 배포 감지', () => {
    it.each([
        'npm run deploy',
        'npm.cmd run deploy',
        'npm --prefix functions run deploy',
        'npm run --prefix functions deploy',
        'npm --prefix=functions run deploy',
        'cd functions && npm run deploy',
        'cd functions; npm run deploy',
        'pnpm run deploy',
        'yarn deploy',
        'yarn run deploy',
        'npm run deploy:functions',
    ])('감지: %s', (cmd) => {
        expect(isDeployCommand(cmd)).toBe(true);
    });
});

describe('isDeployCommand — 비배포 명령 오탐 없음', () => {
    it.each([
        'npm run build',
        'npm run dev',
        'npm test',
        'npm run type-check && npm run lint',
        'npx vitest run',
        'firebase emulators:exec --only firestore "vitest run"',
        'firebase functions:log',
        'npx firebase-tools emulators:start',
        'firebase --project prod functions:log',
        'firebase -P default emulators:start',
        'firebase --project deploy-test functions:log', // 프로젝트 이름에 deploy가 들어가도 배포가 아니다
        'npx firebase-tools@13 emulators:exec "vitest run"',
        // gcloud 조회·로그는 배포가 아니다
        'gcloud functions list --regions asia-northeast3',
        'gcloud functions logs read onDriveLogCreated',
        'gcloud run services describe ondrivelogcreated',
        'gcloud functions describe foo --gen2',
        'gcloud --project deploy-test functions list',
        'gcloud app deploy', // 이 저장소는 App Engine을 쓰지 않는다 (가드 범위 밖)
        'git push origin master', // CI 배포 트리거는 가드 대상이 아님 (정상 경로)
        'npm run deploy-docs',    // deploy 정확 매칭이 아니므로 통과 (해당 스크립트 없음)
        'echo "firebase deploy는 금지"', // 문자열 안 언급이지만 셸에서 실행되지 않... (주의: 단순 echo는 감지돼도 무해)
        'gh run watch --exit-status',
        'npm run predeploy-check',
    ])('통과: %s', (cmd) => {
        expect(isDeployCommand(cmd)).toBe(false);
    });

    it('문자열이 아닌 입력은 false', () => {
        expect(isDeployCommand(undefined)).toBe(false);
        expect(isDeployCommand(null)).toBe(false);
        expect(isDeployCommand(42)).toBe(false);
    });
});
