import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative paths so built files work with file:// (Electron packaged apps)
  base: './',
  root: './',
  build: {
    outDir: './dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    // Aggressive minification for older hardware with limited RAM
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        dead_code: true,
        passes: 3,
      },
      format: {
        comments: false,
      },
    },
    // Code splitting for better caching and parallel loading
    // Ensure output files are emitted under a local `assets/` folder
    // and referenced using relative paths (no leading slash)
    rollupOptions: {
      output: {
        manualChunks: {
          'codemirror': ['@codemirror/state', '@codemirror/view', '@codemirror/theme-one-dark'],
          'react': ['react', 'react-dom'],
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    // Limit chunk size warnings to avoid split modules
    chunkSizeWarningLimit: 1000,
    // Use native ESM imports (better for older systems)
    target: 'es2020',
    // Optimize CSS
    cssCodeSplit: true,
    // Reduce memory usage during build
    ssrManifest: false,
  },
  plugins: [react()],
  // Performance optimizations for dev mode
  // server: {
  //   middlewareMode: true,
  // },
});
