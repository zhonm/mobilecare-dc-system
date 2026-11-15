import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-turnstile-dev-api',
      configureServer(server) {
        server.middlewares.use('/api/verify-turnstile', (req, res, next) => {
          if (req.method !== 'POST') return next();
          let rawBody = '';
          req.on('data', (chunk) => {
            rawBody += chunk;
          });
          req.on('end', () => {
            try {
              const parsed = rawBody ? JSON.parse(rawBody) : {};
              const token = parsed?.token ?? parsed?.['cf-turnstile-response'];
              if (typeof token === 'string' && token.trim().length > 0) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, devLocal: true }));
                return;
              }
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'missing_token' }));
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'invalid_json' }));
            }
          });
        });
      }
    }
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/data/gsxPartsCatalog.json') || id.includes('/src/data/consumablesToolsSeed.json')) {
            return 'data-catalog';
          }
          if (id.includes('/src/data/rawMasterlistData')) {
            return 'data-masterlist';
          }
          if (id.includes('/src/assets/') && id.includes('Base64')) {
            return 'assets-base64';
          }
          if (id.includes('node_modules')) {
            if (id.includes('exceljs') || id.includes('fast-csv') || id.includes('archiver')) {
              return 'vendor-exceljs';
            }
            if (id.includes('xlsx')) {
              return 'vendor-xlsx';
            }
            if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('dompurify')) {
              return 'vendor-pdf';
            }
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-charts';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
          }
        }
      }
    }
  }
});
