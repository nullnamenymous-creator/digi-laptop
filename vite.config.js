import { defineConfig, loadEnv } from 'vite';
import { serveProductPhoto } from './api/product-photo.js';

export default defineConfig(({ mode }) => {
  const { VITE_SUPABASE_URL } = loadEnv(mode, process.cwd());
  const photoRoute = (server) => {
    server.middlewares.use('/foto-produk', (req, res) => serveProductPhoto(req, res, VITE_SUPABASE_URL));
  };
  return {
    plugins: [{ name: 'public-product-photo', configureServer: photoRoute, configurePreviewServer: photoRoute }],
    server: { host: '0.0.0.0' },
    preview: { host: '0.0.0.0' },
  };
});
