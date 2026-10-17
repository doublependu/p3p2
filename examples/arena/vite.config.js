// A plain object, with nothing imported: the same file works wherever the project is copied to.
export default {
  // Relative addresses: the built page works under any path, /arena/ included.
  base: './',
  // Without this, Vite's dev server hands the whole client to every visitor in one piece.
  optimizeDeps: { exclude: ['@p3p2/client'] },
  // The version of the game is the build: a room keeps players on different builds apart.
  define: { BUILD_ID: JSON.stringify(process.env.BUILD_ID || Date.now().toString(36)) },
}
