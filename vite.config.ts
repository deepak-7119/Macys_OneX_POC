import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'transaction-history': resolve(
          import.meta.dirname,
          'applications/transaction-history/src/entry.tsx',
        ),
        'associate-communications': resolve(
          import.meta.dirname,
          'applications/associate-communications/src/entry.tsx',
        ),
      },
      output: {
        entryFileNames: 'modules/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (id.includes('/platform/thread/')) return 'thread';
          if (id.includes('/platform/spool/src/runtime.')) return 'spool-runtime';
          if (id.includes('/platform/spool/src/client.')) return 'spool-client';
        },
      },
    },
  },
});
