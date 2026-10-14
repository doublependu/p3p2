// Makes a large value small enough to send.
//
// One frame holds 64 KB on a server with default settings, and a saved value, an op and a
// snapshot are each one frame. A world of placed blocks outgrows that as text, and packs to a
// sixth of it: such text repeats itself. `pack` turns any JSON value into a string, which can
// go anywhere a value can: a snapshot of the log, a value the room keeps, a message.
//
//   room.log.open({
//     load: async (state) => world.restore(await unpack(state)),
//     apply: (op) => world.apply(op),
//     save: () => pack(world.serialize()),       // serialized now, packed when it is ready
//   })
//
// Both take a moment, and return promises: the browser's own compression works in the
// background. `LogReader.load` and `save` may return promises for this reason.

/** What a packed value starts with, so that `unpack` can tell it from a value that was never packed. */
const MARK = 'p3p2z1:'

async function through(stream: CompressionStream | DecompressionStream, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const piped = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

/** Packs any JSON value into a string. Text that repeats itself, as saved game state does, comes out several times smaller. */
export async function pack(value: unknown): Promise<string> {
  const bytes = await through(new CompressionStream('deflate-raw'), new TextEncoder().encode(JSON.stringify(value)))
  let binary = ''
  // In pieces: a function cannot be called with a million arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return MARK + btoa(binary)
}

/**
 * The value that was packed. Anything that is not a packed value comes back as it is, so a
 * game can start packing what it used to save plain. Rejects when a packed value is damaged.
 */
export async function unpack(packed: unknown): Promise<unknown> {
  if (typeof packed !== 'string' || !packed.startsWith(MARK)) return packed
  const binary = atob(packed.slice(MARK.length))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return JSON.parse(new TextDecoder().decode(await through(new DecompressionStream('deflate-raw'), bytes)))
}
