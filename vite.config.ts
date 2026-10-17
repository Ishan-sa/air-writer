import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';

/** Dev-only: receives tracking diagnostics from the control view (see src/control/diag.ts). */
const diagLog = (): Plugin => ({
  name: 'air-writer-diag',
  configureServer(server) {
    mkdirSync('logs', { recursive: true });
    server.middlewares.use('/__diag', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        appendFileSync('logs/diag.jsonl', body);
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  plugins: [diagLog()],
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
