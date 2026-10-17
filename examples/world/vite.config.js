// A plain object, with nothing imported: the same file works wherever the project is copied to.
export default {
  // Relative addresses: the built pages work under any path, /world/ included.
  base: './',
  // Without this, Vite's dev server hands the whole client to every visitor in one piece.
  optimizeDeps: { exclude: ['@p3p2/client'] },
  // The version of the game is the build: two builds can raise different worlds from one seed.
  define: { BUILD_ID: JSON.stringify(process.env.BUILD_ID || Date.now().toString(36)) },
  // Two pages of one game: the yard, and the cellar under it.
  build: { rolldownOptions: { input: ['index.html', 'cellar.html'] } },
}
