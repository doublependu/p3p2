# Adding multiplayer to a game

How to take a single-player web game and let several people play it together through a p3p2
server. It goes as far as a shared world, players who see each other, and a room that remembers,
and then a state too large for one message, and a simulation that one player runs for the
others.

You need the game's source, and a p3p2 server to try it against. The one in this repository
runs on your own machine: [Try it on one machine](../README.md#try-it-on-one-machine).

## What the player gets

A 👥 button in a corner of your game. Behind it:

1. a field to paste a **room URL** into, which the owner of a p3p2 server gives out;
2. a button that turns that into an **invite link**, with a QR code;
3. for whoever opens the link, a question, *Join?*, and then the same room;
4. a list of who is there, and chat.

Your game decides what being in the same room means.

## 1. Get the client into the game

```sh
npm install @p3p2/client
```

With Vite, add this to `vite.config.js`, or the dev server hands the whole library to every
visitor in one piece:

```js
optimizeDeps: { exclude: ['@p3p2/client'] },
```

A game without a bundler takes one file instead, and finds the library at `window.P3P2`,
`Smooth` at `P3P2.Smooth` and `pack` at `P3P2.pack`:

```html
<script src="https://cdn.jsdelivr.net/npm/@p3p2/client@0.1/dist/p3p2.iife.js"></script>
```

To try a change to the client that isn't released yet, build it in a checkout of this
repository, and install the packed file in the game:

```sh
npm run build && npm pack --workspace @p3p2/client      # in the checkout: gives p3p2-client-0.1.1.tgz
npm install ../p3p2/p3p2-client-0.1.1.tgz               # in the game
```

## 2. Join a room before the world is built

```js
import { P3P2 } from '@p3p2/client'      // under 2 KB; the rest loads when a room is opened

const p3p2 = new P3P2({
  game: { id: 'my-game', version: BUILD_ID },   // see "The version", below
  ui: { corner: 'top-left' },                   // wherever your own controls are not
})

// Back into the room after a reload, or "Join?" for a page opened from an invite link.
// On an ordinary visit this resolves to null at once, and asks no server anything.
const room = await p3p2.start()
```

Put this **before anything is built from a seed**. If the page was opened from an invite, the
room may already hold a world, and the page should build that one and not its own. Wait here,
and nowhere else.

## 3. Whoever comes first decides the world

```js
// The world this page would build on its own.
const mine = { seed: mySeed, startedAt: Date.now() }

p3p2.on('room', async (room) => {
  // Saved only if the room has no world yet. Either way: what the room holds now.
  const world = await room.offer('world', mine)
  if (world.seed !== mySeed) location.reload()      // the room's world wins; build it after the reload
})
```

- `p3p2.on('room')` is called for a room the page came up in, and for one the player opens later
  from the panel, in the middle of a game.
- `offer` is what makes "first" mean the same thing to everybody. Two players who open an empty
  room at the same moment get the same answer.
- After the reload, `p3p2.start()` puts the page back in the room, and `room.retained('world')`
  has the world to build.
- A room keeps its world when everybody has left. Whoever opens it next week gets it.

A clock goes the same way. Save what your clock read and `room.now()` at that moment, and
everybody reads the time as `then + (room.now() - at)`. `room.now()` is the server's clock,
which is the same for all players.

## 4. Show the players to each other

```js
import { Smooth } from '@p3p2/client/smooth'     // 1.4 KB, and only if you import it

const friends = new Smooth({ angles: [2] })       // x, z, heading

// Say where this player is. Call it as often as you like: at most 20 a second are sent.
room.presence.set({ x, z, yaw })

// Hear where the others are, and when: `at` is the moment the server got it.
room.presence.on((member, p, at) => {
  if (p) friends.set(member.id, [p.x, p.z, p.yaw], at)
  else friends.delete(member.id)                  // null: they cleared it
})
room.on('member-leave', (member) => friends.delete(member.id))

// Every frame, for each friend: where to draw them now.
const at = friends.get(member.id)                 // [x, z, yaw], or null
```

- **Presence is for "where I am now".** Only the latest value counts, the server passes changes
  on twenty times a second, and a late one is dropped, not delivered late.
- **Draw from `Smooth`, not from what arrives.** Reports come ten or twenty times a second and
  unevenly. `Smooth` draws each thing a little in the past, between two reports.
- **Give `Smooth` the time, `at`.** Without it a report is dated by when it arrived, which is up
  to a twentieth of a second after the server got it, a different amount each time. Something
  that moves fast is then drawn going forward and back: at 70 km/h, by a few tens of
  centimetres.
- **What arrives is somebody else's data.** Check that it is the numbers you expect before you
  put a camera or a mesh there.
- `member.pid` is the same for the same person on every visit. Take a player's colour from it.

## 5. Let the room remember

```js
// One value per player, kept on the server. Still there next week.
room.send('where', { x, z }, { retain: 'player' })
const mine = room.retained('where', { player: room.self.pid })
```

For something that changes through many small steps and must come out the same for everybody,
like which coins have been picked up, use the room's log:

```js
room.log.open({
  load: (state) => world.restore(state),      // the last snapshot, or undefined
  apply: (op) => world.apply(op),             // every op since, then each new one, in one order
  save: () => world.serialize(),              // on the host, when the server asks
})
room.log.submit({ coin: 12 })                 // takes effect when it comes back through `apply`
```

Change the state only in `apply`, and two players who reach for the same coin are told the same
thing about who had it.

## 6. One player runs what has to run once

Enemies, a clock that somebody must wind, a ball: things that have to be decided in one place.
p3p2 names one member the **host** for that: the first to join, and after them the earliest who
is connected and looking at the page. The role passes on when the host leaves, closes or reloads
the page, puts it in the background, drops for five seconds, or its page stops for three.

```js
// The host decides, and says what it sees. `volatile`: a late report is dropped, not queued.
if (room.isHost) room.send('units', packedUnits, { volatile: true })

// Everybody else draws it, and takes only the host's word.
room.on('units', (data, from) => {
  if (from === room.host && !room.isHost) world.show(data)
})

// What the others want done, they ask the host for.
room.send('hit', { unit, damage }, { to: 'host' })

// The host changed. If it is this page now: carry on from what it was drawing.
room.on('host-change', () => {
  if (room.isHost) world.takeOver()
})
```

- **Say everything again now and then.** A report that names every unit, ten times a second, is
  also all a newcomer needs, and all the next host needs.
- **What must not be lost is not `volatile`**: a wall that came down, a change of phase.
- **Bytes are cheaper than JSON** for a list that goes out ten times a second: `room.send`
  takes an `ArrayBuffer` or a typed array, and the others get a `Uint8Array`.
- **Something different for each player** goes in one message: `room.sendEach(channel, [[member,
  bytes], …])`. Each member gets its own part as an ordinary binary message from the host, and
  the whole counts once against the host's rate. For a world too big to send everybody all of
  it, where each player is sent what that player can see; or for cards dealt face down.

```js
// The host, ten times a second: what each guest can see, as bytes made for that guest.
room.sendEach('view', guests.map((m) => [m, world.viewFor(m)]), { volatile: true })
```
- **Each player's own character stays their own page's.** The host is told where it is
  (presence), and tells its owner when something hits it. Something the others can dodge, a
  round in flight, is better flown on every page and judged on the page whose player it
  reaches: then what hits you on your screen is what hits you.
- **Know who is there to wait for, or to aim at.** A member whose page is in the background,
  or whose connection is down, keeps its place in the room for a while, and cannot play:

```js
room.on('member-state', (member, state) => {
  // 'here', 'away' (its page is in the background) or 'lost' (no word from it for 3 seconds)
  if (state !== 'here') horde.forget(member.id)
})
const targets = room.members.filter((m) => m !== room.self && m.state === 'here')
```

- **A host that reloads comes back as a guest.** What its page held of the game went with the
  page, so the role has passed on by then. The new host carries on from what it was shown.
- **Friends can cheat.** The host's game is the referee, and the host is one of the friends.

## When the state is large

One message, one saved value and one snapshot are each at most 64 KB on a server with default
settings. A world of placed blocks outgrows that as JSON, and packs to a fifth of it:

```js
import { pack, unpack } from '@p3p2/client/pack'      // 0.5 KB, and only if you import it

room.log.open({
  load: async (state) => world.restore(await unpack(state)),   // ops wait until this resolves
  apply: (op) => world.apply(op),
  save: () => pack(world.serialize()),       // serialized now, packed in the background
})
const world = await unpack(await room.offer('world', await pack(mine)))
```

- **A snapshot is for whoever comes later.** Nobody who is in the room is told of it. What
  everybody has to learn of now is an op, or a room value.
- **Many small changes in one go are one op**: put them in a list and submit that. A player may
  send 90 messages a second.

## The version

`game.version` keeps players on different versions of the game out of each other's rooms. For a
world built from a seed, **make it the build**, not a number you remember to bump: two builds
can make different worlds from one seed.

```js
// vite.config.js
define: { BUILD_ID: JSON.stringify(Date.now().toString(36)) },
```

The cost: after a deploy, players on the old build cannot join a room that people on the new one
are in, until they reload. A version is at most 32 characters, without spaces; a whole commit
hash is 40.

## A game across several pages

A world in parts, each part a page of its own, with a way from one to the next that loads the next
page: one room holds them all.

- **Give every page the same `game.id`.** The page that closes says so, and the next one picks the
  same place in the room back up by itself, as the same member, without asking. That is kept per
  tab, under the game's id.
- **Keep the parts on one site.** The player is the same player on every page of one origin. On
  another site the browser keeps another player, and the room has to list that site too.
- **Say which part a player is in**, in their presence, and draw only those in the same part.
- **Saved values and the log are the room's, not a part's.** Name what belongs to a part in the op
  (`{part, ...}`), and every page can ignore what is not about its own.
- **The host is the room's**, and may be in another part. What one page has to run for a part (its
  creatures), a page in that part runs: for instance whoever has been in the room longest of those
  in it (`member.order`, among the members whose presence names the part). When that page leaves the
  part, the next carries on from where the others last drew things, not from where they began.
- **Every page load passes the host role on**, since a closing page gives it up. That is quick, and
  nothing is lost, but a game that keeps something in the host's page only loses it at each change.

## Try it

1. Start the server and create a room in its portal. As the game URL give the address you will
   open the game at, with this machine's LAN address and never `localhost`.
2. Open the game there, open 👥, paste the room URL, and create the invite.
3. Open the invite in **another browser**, not another tab: a tab of the same browser is the
   same player. Then scan the QR code with a phone on the same Wi-Fi.
4. `npm run lag` puts 150 ms and a connection that drops in front of the server:
   [Testing on a bad connection](../README.md#testing-on-a-bad-connection).

## What goes wrong

- **Two browsers build two different worlds from one seed.** Anything that calls a seeded
  `Math.random` a number of times the browser decides will do it: `sort` with a random
  comparison is the classic. Test with Chrome and Firefox in one room, and compare a fingerprint
  of what each built. A game had this for months, and its tests, in one browser, never saw it.
- **The page builds its own world and then learns of the room's.** Wait for `p3p2.start()` first.
- **There is no corner to spare for 👥.** `ui: { button: false }` leaves it out, and
  `p3p2.open()` opens the panel from a button of your own.
- **Your own touch handling eats the panel's taps.** A listener that cancels touches for the whole
  page, in the capturing phase, also cancels the ones on 👥. Leave touches on `p3p2-panel` alone.
- **A key your game uses types into the chat, or the other way round.** Keys typed in the panel
  do not reach the game. `P3P2.isTyping` says when, for a game that listens in the capturing
  phase. Enter opens the chat; `ui: { chatKey: false }` turns that off.
- **A friend is "another player" after a reload.** They are not: a reload comes back as the same
  member. Somebody who closes the page keeps their place for 30 seconds.

[sharing-state.md](sharing-state.md#the-traps) has the rest of the traps.


## Before you call it done

| | |
|---|---|
| Alone, the game is what it was | An ordinary visit loads one small file more, and asks no server anything |
| Two, and the most you expect | Everybody holds the same shared state |
| A slow connection that drops | Through `npm run lag`: it still comes out the same |
| A reload | Of a guest, and of whoever opened the room |
| Everybody leaves and comes back | What the room should remember is there |
| Two browser engines in one room | The same world |
| A phone | Playable, and 👥 is not under a control of yours |

[testing.md](testing.md) says how each of these is tested on one machine.
