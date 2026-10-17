import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
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

// `npm run dev:lan` serves over HTTPS on the local network, so another computer
// can open the app (Chrome only allows the camera on localhost or HTTPS)
const lan = !!process.env.LAN;

export default defineConfig({
  plugins: [diagLog(), ...(lan ? [basicSsl()] : [])],
  server: { port: 5199, strictPort: true, host: lan },
  build: {
    rollupOptions: {
      input: {
        control: resolve(__dirname, 'index.html'),
        wall: resolve(__dirname, 'wall.html'),
        sounds: resolve(__dirname, 'sounds.html'),
      },
    },
  },
  test: { environment: 'node' },
});
