import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'pages/dashboard.html'),
        admin: resolve(__dirname, 'pages/admin.html'),
        lobby: resolve(__dirname, 'pages/lobby.html'),
        faq: resolve(__dirname, 'pages/faq.html'),
      },
    },
  },
  server: {
    open: '/',
  },
});
