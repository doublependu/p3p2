import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatInvite, inviteFromUrl, inviteUrl, parseInvite, parseRoomUrl, roomUrl } from '../src/links.ts'

const CODE = '789xyz0abc'
const KEY = '0123456789abcdefghjkmnpqrs'

test('invite: https is implied, other schemes are written out', () => {
  assert.deepEqual(parseInvite(`p3p2.example.com/${CODE}`), { server: 'https://p3p2.example.com', code: CODE })
  assert.deepEqual(parseInvite(`http://192.168.1.118:8080/${CODE}`), {
    server: 'http://192.168.1.118:8080',
    code: CODE,
  })
  assert.equal(formatInvite({ server: 'https://p3p2.example.com', code: CODE }), `p3p2.example.com/${CODE}`)
  assert.equal(
    formatInvite({ server: 'http://192.168.1.118:8080', code: CODE }),
    `http://192.168.1.118:8080/${CODE}`,
  )
})

test('invite: a server under a path keeps the path', () => {
  const ref = parseInvite(`example.com/p3p2/${CODE}`)
  assert.deepEqual(ref, { server: 'https://example.com/p3p2', code: CODE })
  assert.equal(formatInvite(ref!), `example.com/p3p2/${CODE}`)
})

test('invite: rejects junk', () => {
  for (const v of [
    '',
    null,
    undefined,
    CODE,
    `/${CODE}`,
    'p3p2.example.com/short',
    `p3p2.example.com/${CODE}x`,
    `p3p2.example.com/789xyz0abi`, // i is not in the alphabet
    `ftp://p3p2.example.com/${CODE}`,
    `javascript:alert(1)/${CODE}`,
    `user:pw@p3p2.example.com/${CODE}`,
    `p3p2.example.com?x=1/${CODE}`,
    `${'a'.repeat(500)}.com/${CODE}`,
  ]) {
    assert.equal(parseInvite(v), null, String(v))
  }
})

test('invite: codes are case-insensitive', () => {
  assert.equal(parseInvite(`p3p2.example.com/${CODE.toUpperCase()}`)?.code, CODE)
})

test('invite link: built from the page address and read back', () => {
  const ref = { server: 'http://192.168.1.118:8080', code: CODE }
  const page = 'http://192.168.1.118:5173/games/my-game/?debug=1&room=old.example/0000000000#top'
  const link = inviteUrl(page, ref)
  assert.equal(link, `http://192.168.1.118:5173/games/my-game/?debug=1&room=http://192.168.1.118:8080/${CODE}`)
  assert.deepEqual(inviteFromUrl(link), ref)

  const https = { server: 'https://p3p2.example.com', code: CODE }
  assert.equal(inviteUrl('https://game.example.com/', https), `https://game.example.com/?room=p3p2.example.com/${CODE}`)
  assert.deepEqual(inviteFromUrl(inviteUrl('https://game.example.com/', https)), https)
})

test('invite link: the parameter name is configurable', () => {
  const ref = { server: 'https://p3p2.example.com', code: CODE }
  const link = inviteUrl('https://game.example.com/?room=lobby-7', ref, 'p3p2')
  assert.equal(link, `https://game.example.com/?room=lobby-7&p3p2=p3p2.example.com/${CODE}`)
  assert.deepEqual(inviteFromUrl(link, 'p3p2'), ref)
  assert.equal(inviteFromUrl(link), null)
})

test('invite link: no parameter, or a bad address', () => {
  assert.equal(inviteFromUrl('https://game.example.com/'), null)
  assert.equal(inviteFromUrl('not a url'), null)
})

test('room URL: parse and format', () => {
  const ref = parseRoomUrl(`  https://p3p2.example.com/room/${KEY}  `)
  assert.deepEqual(ref, { server: 'https://p3p2.example.com', key: KEY })
  assert.equal(roomUrl(ref!), `https://p3p2.example.com/room/${KEY}`)
  assert.deepEqual(parseRoomUrl(`p3p2.example.com/room/${KEY}/`), ref)
  assert.deepEqual(parseRoomUrl(`http://192.168.1.118:8080/room/${KEY}`), {
    server: 'http://192.168.1.118:8080',
    key: KEY,
  })
  assert.deepEqual(parseRoomUrl(`https://example.com/p3p2/room/${KEY}`), { server: 'https://example.com/p3p2', key: KEY })
})

test('room URL: rejects junk', () => {
  for (const v of ['', null, 'p3p2.example.com', `p3p2.example.com/${KEY}`, 'p3p2.example.com/room/abc', `x y/room/${KEY}`]) {
    assert.equal(parseRoomUrl(v), null, String(v))
  }
})
