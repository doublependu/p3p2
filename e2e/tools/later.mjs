// Moves this process's clock on by P3P2_E2E_DAYS days, for the browser tests' "another day": a server started with
// `node --import ./later.mjs` lives that many days after the one that was stopped. The server reads its clock
// through Date.now, so it changes nothing else. Plain JavaScript, so that the published image can load it too
// (through NODE_OPTIONS and a mounted file).

const days = Number(process.env.P3P2_E2E_DAYS ?? 0)
if (Number.isFinite(days) && days !== 0) {
  const real = Date.now
  const shift = days * 24 * 3600_000
  Date.now = () => real() + shift
}
