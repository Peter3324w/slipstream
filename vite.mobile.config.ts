import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

/**
 * The Android build: the same renderer, with src/mobile standing in for preload +
 * main. Output is what Capacitor copies into the APK (capacitor.config.ts).
 */
export default defineConfig({
  root: 'src/mobile',
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src'),
      'node:fs/promises': resolve('src/mobile/shims/fs.ts'),
      'node:path': resolve('src/mobile/shims/path.ts')
    }
  },
  // ionic:serve - the Ionic extension's live reload loads this over the LAN.
  server: { host: true },
  build: { outDir: resolve('out/mobile'), emptyOutDir: true, minify: 'esbuild', sourcemap: false },
  plugins: [react()]
})
