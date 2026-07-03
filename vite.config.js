import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

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
          'firebase-db': ['firebase/firestore', 'firebase/storage'],
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
