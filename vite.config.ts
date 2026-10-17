import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { port: 5199, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        control: resolve(__dirname, 'index.html'),
        wall: resolve(__dirname, 'wall.html'),
      },
    },
  },
  test: { environment: 'node' },
});
