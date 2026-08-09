import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * E2E 전용: 엔트리 청크 단절 시뮬레이션 (프리뷰 서버 한정)
 *
 * boot-failure 스펙이 "청크를 못 받는 회선"을 만들 때 쓴다. Playwright 인터셉션으로
 * 표현하면 WebKit에서 abort·fulfill·unroute 모두 리로드된 페이지에 반영되지 않아
 * (2026-08-09 CI: 리로드 후 청크 재요청 0건) 복구를 검증할 수 없었다. 그래서 실패를
 * 인터셉션이 아니라 **서버가 주는 진짜 503**으로 표현한다 — 브라우저는 평범한 HTTP만
 * 겪으므로 리로드 시 정상적으로 재요청한다.
 *
 * 쿠키로 켜고 끄는 이유: 프리뷰 서버는 병렬 워커가 공유하므로 전역 플래그면 다른
 * 테스트까지 끊긴다. 단절을 원하는 테스트만 자기 컨텍스트에 쿠키를 심는다.
 * 프리뷰 서버는 로컬 검증·E2E에서만 쓰이므로 프로덕션(Firebase Hosting)과 무관하다.
 */
const E2E_OUTAGE_COOKIE = 'vdl-e2e-outage=1'
const E2E_OUTAGE_CHUNK = /^\/assets\/(lightEntry|LandingPage)-[^/]+\.js/

function e2eEntryOutage() {
  return {
    name: 'e2e-entry-outage',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const wantsOutage = (req.headers.cookie ?? '').includes(E2E_OUTAGE_COOKIE)
        if (wantsOutage && E2E_OUTAGE_CHUNK.test(req.url ?? '')) {
          res.statusCode = 503
          res.setHeader('cache-control', 'no-store')
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': __dirname + 'src',
      'xlsx': 'xlsx/dist/xlsx.mini.min.js',
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    e2eEntryOutage(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-512.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: false, // public/manifest.json 직접 사용
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webp}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    proxy: {
      '/api/holiday': {
        target: 'https://apis.data.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/holiday/, '/B090041/openapi/service/SpcdeInfoService'),
      },
      '/api/tmap': {
        target: 'https://apis.openapi.sk.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tmap/, '/tmap'),
      },
    },
  },
  build: {
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          'firebase-auth': ['firebase/app', 'firebase/auth'],
          // firestore와 storage를 분리한다 — 합쳐두면 firebase 12.16 기준 단일 청크가 582KB로
          // largestJs 예산(600KB)에 18KB만 남아 다음 마이너 업데이트에서 바로 게이트가 터진다.
          // 증빙 업로드(storage)는 운행일지 작성 일부 경로에서만 쓰여 분리 시 지연 로딩 여지도 생긴다.
          'firebase-db': ['firebase/firestore'],
          'firebase-storage': ['firebase/storage'],
          'firebase-messaging': ['firebase/messaging'],
          // react-dom/client·jsx-runtime·scheduler 서브패스를 명시하지 않으면 렌더러 본체(~200KB)가
          // 앱 공유 청크로 흘러들어가 매 배포마다 재다운로드된다 (react-vendor는 버전 업 전까지 캐시 유지)
          'react-vendor': [
            'react',
            'react/jsx-runtime',
            'react-dom',
            'react-dom/client',
            'scheduler',
            'react-router',
            'react-router-dom',
          ],
          'xlsx': ['xlsx'],
          // sentryClient(재수출 파사드)를 SDK와 같은 청크에 강제 배치 — 파사드가 자체 코드가 없어
          // Rollup이 공유 청크로 접어 넣으면 SDK로의 정적 엣지가 생겨 지연 로딩이 무력화된다
          'sentry': ['@sentry/react', './src/lib/sentryClient.ts'],
          'date-fns': ['date-fns'],
          'recharts': ['recharts'],
          'leaflet': ['leaflet'],
          'image-compression': ['browser-image-compression'],
        },
      },
    },
  },
})
