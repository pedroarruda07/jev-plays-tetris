import { defineConfig, loadEnv } from 'vite';
import { jevPlugin } from './server/jev-route';

export default defineConfig(({ mode }) => {
  // Empty prefix loads server credentials without exposing them to import.meta.env.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [jevPlugin(env.JEV_API_KEY ?? '', env.JEV_MODEL ?? 'jev-latest')],
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
  };
});
