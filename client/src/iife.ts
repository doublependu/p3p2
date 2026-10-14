// For games without a bundler: <script src="p3p2.iife.js"> defines window.P3P2. One file has everything: the
// drawing of remote things smoothly (P3P2.Smooth) and the packing of large values (P3P2.pack, P3P2.unpack) come along.
import { P3P2 } from './index.ts'
import { pack, unpack } from './pack.ts'
import { Smooth } from './smooth.ts'

export default Object.assign(P3P2, { Smooth, pack, unpack })
