import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon-512.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: false, // public/manifest.json 직접 사용
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__\/auth\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webp}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Firebase Storage 이미지 (차량 사진, OCR 결과 등)
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'firebase-storage',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
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
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
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
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'recharts': ['recharts'],
          'xlsx': ['xlsx'],
          'sentry': ['@sentry/react'],
          'date-fns': ['date-fns'],
        },
      },
    },
  },
})
