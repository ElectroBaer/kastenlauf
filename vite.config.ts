import { defineConfig } from 'vite';

// Project Page auf GitHub Pages: https://<user>.github.io/kastenlauf/
// Bei einer User-/Org-Page oder eigener Domain hier auf '/' stellen.
export default defineConfig({
  base: '/kastenlauf/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
