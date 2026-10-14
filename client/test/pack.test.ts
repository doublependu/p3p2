import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pack, unpack } from '../src/pack.ts'

test('a packed value comes back as it was', async () => {
  for (const value of [null, 0, 'x', [1, [2]], { a: { b: null }, text: 'grüße, 世界' }]) {
    const packed = await pack(value)
    assert.equal(typeof packed, 'string')
    assert.deepEqual(await unpack(packed), value)
  }
})

test('a world of placed blocks packs to a fraction of its size, and fits a frame', async () => {
  // 12,000 edits, written down the way a voxel game does it: walls, layer on layer, in order.
  // (A real one for comparison: a voxel game's starter town, 840 edits, packs from 17.5 KB to 3.5 KB.)
  const layers = ['cobble', 'cobble', 'stone_wall', 'stone_wall', 'planks']
  const edits: [number, number, number, string][] = []
  for (let town = 0; edits.length < 12_000; town++) {
    for (const [y, name] of layers.entries()) {
      for (let i = -15; i <= 15; i++) edits.push([town * 40 + i, 8 + y, -15, name], [town * 40 + i, 8 + y, 15, name])
      for (let k = -14; k <= 14; k++) edits.push([town * 40 - 15, 8 + y, k, name], [town * 40 + 15, 8 + y, k, name])
    }
  }
  const world = { format: 'voxel-world', seed: 'valley', edits }
  const plain = JSON.stringify(world).length
  const packed = await pack(world)
  assert.ok(plain > 200_000, `${plain}`)
  assert.ok(packed.length < 64 * 1024, `${packed.length} of ${plain}`)
  assert.ok(plain / packed.length > 4, `${packed.length} of ${plain}`)
  assert.deepEqual(await unpack(packed), world)
})

test('what was never packed comes back as it is; a damaged packed value is refused', async () => {
  assert.deepEqual(await unpack({ seed: 7 }), { seed: 7 })
  assert.equal(await unpack('just a string'), 'just a string')
  assert.equal(await unpack(undefined), undefined)
  await assert.rejects(unpack('p3p2z1:AAAA////'))
})
