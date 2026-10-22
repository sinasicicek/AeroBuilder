import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'fs';
import seoPlugin from './seo/seoPlugin';

const buildVersion = Date.now().toString();

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 1932,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 1932,
    strictPort: true,
  },
  plugins: [
    react(),
    seoPlugin(),
    {
      name: 'generate-version-file',
      closeBundle() {
        // Write a version.json into the dist folder after every build
        writeFileSync(
          'dist/version.json',
          JSON.stringify({ version: buildVersion })
        );
      },
    },
  ],
  define: {
    // Inject build version as a global constant accessible in the app
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
      },
    },
  },
});
