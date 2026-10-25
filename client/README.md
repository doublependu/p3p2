# @p3p2/client

Multiplayer for static web games, through a small server of your own. The server's owner sends a room's invite
link, or its QR code, to friends, and everyone who opens the link, the owner too, plays and chats together. A
reload, a dropped connection, or a phone switching networks comes back by itself.

It takes a p3p2 server: one Docker image, [`p3p2/p3p2`](https://hub.docker.com/r/p3p2/p3p2), on the smallest
VPS there is ([hosting a server](https://github.com/doublependu/p3p2/blob/main/docs/self-host.md)).
[p3p2.me](https://p3p2.me/) explains how to get a p3p2 server.

## Install

```sh
npm install @p3p2/client
```

With Vite, add this to `vite.config.js`, or the dev server hands the whole library to every visitor in one
piece:

```js
optimizeDeps: { exclude: ['@p3p2/client'] },
```

A game without a bundler takes one file, which defines `window.P3P2` (with `P3P2.Smooth` and `P3P2.pack`):

```html
<script src="https://cdn.jsdelivr.net/npm/@p3p2/client@0.2/dist/p3p2.iife.js"></script>
```

## A few lines

```js
import { P3P2 } from '@p3p2/client'

const p3p2 = new P3P2({ game: { id: 'my-game', version: '1.0.0' } })
p3p2.on('room', (room) => {
  room.presence.set({ x, y })                            // where I am; the others hear it 20 times a second
  room.presence.on((member, p) => drawFriend(member, p))
  room.send('shot', { x, y, angle })                     // what happened; the server never reads it
  room.on('shot', (data, from) => drawShot(from, data))
})
await p3p2.start()   // back into the room after a reload, or "Join?" when opened from an invite
```

The server also keeps what a game asks it to: a value for the room, one for each player, and a log of changes
in one order for everybody. One player's page is the host, for what must run in one place, and the role passes
on by itself.

## What it weighs

| | gzip | |
|---|---|---|
| `@p3p2/client` | under 2 KB | On every visit. An ordinary visit asks no server anything. |
| The room client and the panel | under 15 KB | Loaded when a room is opened |
| `@p3p2/client/smooth` | 1.4 KB | Drawing remote things smoothly, only if imported |
| `@p3p2/client/pack` | 0.5 KB | Packing large values, only if imported |
| `dist/p3p2.iife.js` | under 20 KB | All of it, in one file |

## The documents

- [Adding multiplayer to a game](https://github.com/doublependu/p3p2/blob/main/docs/integrate.md), step by step
- [Which state goes where](https://github.com/doublependu/p3p2/blob/main/docs/sharing-state.md), and the traps
- [The client, call by call](https://github.com/doublependu/p3p2/blob/main/docs/api.md)
- [Testing](https://github.com/doublependu/p3p2/blob/main/docs/testing.md) with several players on one machine
- [What the keys protect](https://github.com/doublependu/p3p2/blob/main/docs/security.md), and what not

## Licence

MIT. The QR code is drawn by [lean-qr](https://github.com/davidje13/lean-qr), bundled in, also under MIT:
`LICENSE` has both notices. The server is under the AGPL, in
[the same repository](https://github.com/doublependu/p3p2).
