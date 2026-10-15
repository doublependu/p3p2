import { defineConfig } from 'vite'

// The QR code is drawn by lean-qr, bundled in. Its licence asks for its notice in every copy, and a file of this
// package may travel alone (the IIFE from a CDN), so the files that carry its code name it; LICENSE has the text.
const LEAN_QR = '/*! Includes lean-qr, MIT License, Copyright (c) 2021-2025 David Evans, https://github.com/davidje13/lean-qr */'

// Two builds: ESM, split into an entry and lazy chunks, and one IIFE file for games
// without a bundler (an IIFE cannot load chunks, so it carries everything).
export default defineConfig(({ mode }) => {
  const iife = mode === 'iife'
  return {
    build: {
      target: 'es2022',
      emptyOutDir: !iife,
      sourcemap: true,
      lib: iife
        ? { entry: 'src/iife.ts', name: 'P3P2', formats: ['iife'], fileName: () => 'p3p2.iife.js' }
        : // Three ways in: the library itself, and two helpers that need none of it.
          {
            entry: { p3p2: 'src/index.ts', 'p3p2-smooth': 'src/smooth.ts', 'p3p2-pack': 'src/pack.ts' },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
      rollupOptions: {
        // Lets the code the entry shares with the lazy chunks live in the entry file, so a normal
        // visit is one small request. The cost: the entry gains a few exports with mangled names.
        preserveEntrySignatures: 'allow-extension',
        // postBanner: added after minification, which would drop it.
        output: iife
          ? { exports: 'default', postBanner: LEAN_QR }
          : { chunkFileNames: 'p3p2-[name].js', postBanner: (chunk) => (chunk.name === 'qr' ? LEAN_QR : '') },
      },
    },
  }
})
