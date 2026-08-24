/**
 * 운영 스크립트용 Firebase Admin 초기화 — **대상 프로젝트를 반드시 고정한다.**
 *
 * ## 왜 공용 모듈로 두는가
 *
 * 프로젝트를 고정하지 않으면 Admin SDK는 그 PC의 ADC 기본 프로젝트를 따라간다.
 * `gcloud auth application-default login`은 마지막으로 잡힌 quota project를 딸려 보내고,
 * 그것이 이 프로젝트가 아니면 **엉뚱한 프로젝트를 조회해 에러 없이 0건**이 나온다.
 *
 * 그 0건은 조회 스크립트에서 "없음"으로, 마이그레이션 스크립트에서 "고칠 것이 없음"으로
 * 읽힌다. 둘 다 **조용히 틀린다** — 실패했다고 말해 주지 않으므로 없는 도구보다 나쁘다.
 * 쓰기 스크립트라면 남의 프로젝트에 문서를 만들 수도 있다.
 *
 * ## 실제 사고 (2026-08-24)
 *
 * quota project가 다른 프로젝트(`disability-integrated-care`)로 잡힌 PC에서
 * `check-feedbacks.ts`가 **"등록된 피드백이 없습니다"** 를 출력했다. 실제로는 136건이었다.
 * 같은 PC에서 프로젝트를 고정하던 `delete-anonymous-users.ts`는 정상 동작했다(1828개 조회).
 * 선례는 더 있다 — `seed-calendar-bindings.ts`가 같은 이유로 "차량 0건"을 성공처럼 보여 준
 * 적이 있고, 그때 남긴 처방이 이 모듈의 내용이다.
 *
 * ## 규칙
 *
 * `scripts/` 아래에서 Admin SDK를 초기화하는 스크립트는 **이 함수를 쓰거나, 직접
 * `projectId`를 넘겨야 한다.** `scripts/__tests__/scriptAdminProject.test.ts`가 정적으로
 * 강제한다(맨손 `initializeApp()` 금지).
 */
import { initializeApp, cert, applicationDefault, type App, type ServiceAccount } from 'firebase-admin/app';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ESM 스코프에는 __dirname이 없다(루트 package.json이 "type": "module").
const libDir = dirname(fileURLToPath(import.meta.url));

/** 저장소 루트 기준 경로 (이 파일은 scripts/lib/ 안에 있다) */
const fromRoot = (...parts: string[]) => resolve(libDir, '..', '..', ...parts);

/**
 * 대상 프로젝트 ID.
 *
 * 우선순위: 환경변수 → `.firebaserc`의 default. 환경변수를 먼저 보는 것은 스테이징 등
 * 다른 프로젝트를 의도적으로 지정할 여지를 남기기 위해서다.
 */
export function resolveProjectId(): string | undefined {
    const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (fromEnv) return fromEnv;
    try {
        const rc = JSON.parse(readFileSync(fromRoot('.firebaserc'), 'utf8'));
        return rc?.projects?.default;
    } catch {
        return undefined;
    }
}

/**
 * Admin 앱을 초기화하고 대상 프로젝트를 한 줄로 알린다.
 *
 * 자격증명은 서비스 계정 키 파일이 있으면 그것을, 없으면 ADC를 쓴다. 키 파일 경로는
 * 저장소의 두 선례를 모두 본다(`functions/` 아래와 루트).
 *
 * **프로젝트를 못 찾으면 크게 경고한다.** 조용히 ADC 기본값으로 넘어가면 이 모듈이 막으려는
 * 바로 그 상태가 된다.
 *
 * @param options.quiet 배너를 찍지 않는다. 출력 형식을 스스로 관리하는 스크립트용이며,
 *                      그 경우 **스크립트가 대상 프로젝트를 직접 출력해야 한다.**
 */
export function initAdminApp(options: { quiet?: boolean } = {}): App {
    const projectId = resolveProjectId();

    if (!options.quiet) {
        console.log(`대상 프로젝트: ${projectId ?? '(미지정 — ADC 기본값. 결과를 믿지 말 것)'}`);
        if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
            console.log('⚠️  에뮬레이터 접속 중 — 프로덕션이 아닙니다');
        }
    }
    if (!projectId) {
        console.warn('⚠️  프로젝트를 확정하지 못했습니다. .firebaserc를 읽을 수 없거나 default가 없습니다.');
        console.warn('    GOOGLE_CLOUD_PROJECT를 지정하고 다시 실행하세요 — 그대로 진행하면 다른 프로젝트를 조회할 수 있습니다.');
    }

    for (const candidate of [
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        fromRoot('functions', 'serviceAccountKey.json'),
        fromRoot('serviceAccountKey.json'),
    ]) {
        if (candidate && existsSync(candidate)) {
            const sa = JSON.parse(readFileSync(candidate, 'utf-8')) as ServiceAccount;
            return initializeApp({ credential: cert(sa), ...(projectId ? { projectId } : {}) });
        }
    }
    return initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
}
