import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // The monorepo keeps one .env at the root; without this Vite looks only in
  // packages/web and VITE_API_BASE_URL silently falls back to the default.
  envDir: '../../',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
});
