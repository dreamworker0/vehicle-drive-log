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
# 항상 npm ci를 쓴다. 이미 설치돼 있으면 `npm install`로 빠르게 넘어가던 분기가 있었는데,
# install은 락파일을 **다시 쓴다**. 러너의 npm 버전이 저장소 락파일을 만든 버전과 다르면
# 그 차이만큼 diff가 남는다. 실제로 npm 10.9.7이 @tailwindcss/oxide 리눅스 바이너리 4개에서
# libc 필드(["glibc"] / ["musl"])를 걷어냈다. 의존성이 바뀐 게 아닌데 세션을 재개할 때마다
# 워킹 트리가 더러워져 커밋 여부를 매번 판단해야 했고, 그대로 커밋하면 musl/glibc 환경에서
# 잘못된 바이너리를 받을 수 있다. ci는 락파일을 읽기만 하므로 이 문제가 없다.
# (설치 시간이 증분 대비 10~20초 늘지만, 락파일 오염과 바꿀 만한 값이 아니다.)
install_deps() {
    local dir="$1" label="$2"
    echo "$label 의존성 설치 (npm ci)"
    npm ci --prefix "$dir" --no-audit --no-fund
}

install_deps "." "루트"
install_deps "functions" "functions"

echo "✅ 세션 준비 완료 — Node $(node -v), TZ=Asia/Seoul"
