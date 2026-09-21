import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // electron-vite does not minify by default. For a project whose entire claim
    // is the memory number, shipping 52k lines of readable JS to be parsed and
    // JITed on every launch is not a neutral default.
    build: { minify: 'esbuild', sourcemap: false },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: { alias: shared },
    build: {
      minify: 'esbuild',
      sourcemap: false,
      // A sandboxed preload MUST be CommonJS - Electron cannot load an ESM one,
      // and it fails silently: contextBridge never runs, window.slipstream is
      // simply undefined, and the first call to it throws in the renderer where
      // nothing is watching. The .cjs extension is required because package.json
      // says "type": "module", which would otherwise make a .js file ESM again.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    build: { minify: 'esbuild', sourcemap: false },
    plugins: [react()]
  }
})
