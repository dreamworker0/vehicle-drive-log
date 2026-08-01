#!/bin/bash
# SessionStart 훅 — 클라우드 세션(Claude Code on the web)에서 즉시 작업 가능한 상태를 만든다.
# 컨테이너는 세션마다 새로 만들어지므로 node_modules와 .env가 없다. 이 훅이 둘을 준비한다.
# 로컬에서는 아무것도 하지 않는다(로컬 환경을 건드리면 안 된다).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# --- 1. 시간대 고정 ---
# 예약·운행 시각 로직은 KST 전제. CI 워크플로와 동일하게 맞춘다.
# (vitest는 config에서 자체 고정하지만, Functions 테스트·스크립트 등 나머지를 위해 세션 전역에 설정)
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo 'export TZ="Asia/Seoul"' >> "$CLAUDE_ENV_FILE"
fi

# --- 2. 환경변수 파일 준비 ---
# 우선순위: ENV_FILE 환경변수(파일 전체 내용) → 개별 VITE_ 변수 → 템플릿 복사 + 경고.
# ENV_FILE은 CI의 secrets.ENV_FILE과 같은 형식이라, 그 값을 환경 설정에 그대로 넣으면 된다.
write_env_from_var() {
    local var_content="$1" dest="$2"
    if [ -f "$dest" ]; then
        echo "  $dest 이미 존재 — 유지"
        return 0
    fi
    if [ -n "$var_content" ]; then
        printf '%s\n' "$var_content" > "$dest"
        echo "  $dest 생성 (환경변수에서)"
        return 0
    fi
    return 1
}

echo "환경변수 파일 준비"
if ! write_env_from_var "${ENV_FILE:-}" ".env"; then
    if [ -n "${VITE_FIREBASE_API_KEY:-}" ]; then
        {
            echo "# SessionStart 훅이 개별 환경변수에서 생성"
            echo "VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}"
            echo "VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN:-}"
            echo "VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID:-}"
            echo "VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET:-}"
            echo "VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID:-}"
            echo "VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID:-}"
            echo "VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID:-}"
            echo "VITE_FIREBASE_VAPID_KEY=${VITE_FIREBASE_VAPID_KEY:-}"
            echo "VITE_RECAPTCHA_SITE_KEY=${VITE_RECAPTCHA_SITE_KEY:-}"
            echo "VITE_SENTRY_DSN=${VITE_SENTRY_DSN:-}"
            echo "VITE_TMAP_API_KEY=${VITE_TMAP_API_KEY:-}"
            echo "VITE_HOLIDAY_API_KEY=${VITE_HOLIDAY_API_KEY:-}"
        } > .env
        echo "  .env 생성 (개별 VITE_ 변수에서)"
    elif [ -f .env.example ]; then
        cp .env.example .env
        echo "  ⚠️  .env를 템플릿에서 복사했으나 값이 비어 있다."
        echo "     빌드가 중단되고 pre-push 훅 때문에 푸시도 막힌다."
        echo "     환경 설정에 ENV_FILE(=CI의 secrets.ENV_FILE과 동일 내용)을 추가하면 자동 생성된다."
    fi
fi

if ! write_env_from_var "${FUNCTIONS_ENV_FILE:-}" "functions/.env"; then
    if [ -f functions/.env.example ]; then
        cp functions/.env.example functions/.env
        echo "  functions/.env를 템플릿에서 복사 (값 비어 있음 — Functions 로컬 실행 시 채울 것)"
    fi
fi

# --- 3. 의존성 설치 (루트 + functions) ---
# 컨테이너 상태가 캐시되므로, 이미 설치돼 있으면 증분 install로 빠르게 넘어간다.
install_deps() {
    local dir="$1" label="$2"
    if [ ! -d "$dir/node_modules" ]; then
        echo "$label 의존성 설치 (npm ci)"
        npm ci --prefix "$dir" --no-audit --no-fund
    else
        echo "$label 의존성 확인 (증분)"
        npm install --prefix "$dir" --no-audit --no-fund
    fi
}

install_deps "." "루트"
install_deps "functions" "functions"

echo "✅ 세션 준비 완료 — Node $(node -v), TZ=Asia/Seoul"
