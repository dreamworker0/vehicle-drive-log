// FCM Service Worker에 .env의 Firebase 설정을 빌드 시 자동 주입
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// .env 로드
config({ path: join(rootDir, '.env') });

const template = readFileSync(
    join(rootDir, 'public', 'firebase-messaging-sw.template.js'),
    'utf-8'
);

// 플레이스홀더 ↔ 환경변수 대응
const REQUIRED_KEYS = [
    ['__FIREBASE_API_KEY__', 'VITE_FIREBASE_API_KEY'],
    ['__FIREBASE_AUTH_DOMAIN__', 'VITE_FIREBASE_AUTH_DOMAIN'],
    ['__FIREBASE_PROJECT_ID__', 'VITE_FIREBASE_PROJECT_ID'],
    ['__FIREBASE_STORAGE_BUCKET__', 'VITE_FIREBASE_STORAGE_BUCKET'],
    ['__FIREBASE_MESSAGING_SENDER_ID__', 'VITE_FIREBASE_MESSAGING_SENDER_ID'],
    ['__FIREBASE_APP_ID__', 'VITE_FIREBASE_APP_ID'],
] as const;

// 환경변수가 비었을 때 빈 값으로 덮어쓰지 않고 빌드를 중단한다.
// 빈 config로 생성되면 FCM 서비스워커가 빈 값으로 초기화되어 푸시 알림이 전부 죽고,
// 생성 결과가 Git 추적 파일이라 그대로 커밋될 위험도 있다.
const missing = REQUIRED_KEYS
    .map(([, envKey]) => envKey)
    .filter((envKey) => !process.env[envKey]?.trim());

if (missing.length > 0) {
    console.error('❌ Firebase 환경변수가 비어 있어 firebase-messaging-sw.js 생성을 중단합니다.');
    console.error(`   누락: ${missing.join(', ')}`);
    console.error('   .env에 값을 채운 뒤 다시 빌드하세요 (CI는 secrets.ENV_FILE로 생성).');
    process.exit(1);
}

const output = REQUIRED_KEYS.reduce(
    (acc, [placeholder, envKey]) => acc.replace(placeholder, process.env[envKey] as string),
    template
);

writeFileSync(
    join(rootDir, 'public', 'firebase-messaging-sw.js'),
    output,
    'utf-8'
);

console.log('✅ firebase-messaging-sw.js generated from template');
