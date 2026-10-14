import { defineConfig } from 'vite'

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
        output: iife ? { exports: 'default' } : { chunkFileNames: 'p3p2-[name].js' },
      },
    },
  }
})
