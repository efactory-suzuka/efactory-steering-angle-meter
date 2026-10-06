import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        guide: 'guide.html',
      },
    },
  },
});
