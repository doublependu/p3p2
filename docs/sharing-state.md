# Which state goes where

A game's state comes in a few kinds, and p3p2 has one way to share each. This is the list, with what each kind of
game uses, and then the traps. [integrate.md](integrate.md) is the path from nothing to a shared world; this is the
reference beside it.

| The state | How | Kept when everybody has left |
|---|---|---|
| [What the world is built from](#what-the-world-is-built-from): a seed, a start time | A room value, `room.offer()` | Yes |
| [Where each player is now](#where-each-player-is-now) | Presence | No |
| [What a player owns](#what-a-player-owns): a bag, where they stood | A player value | Yes |
| [Changes that must be kept, in one order](#changes-that-must-be-kept-in-one-order): blocks placed, paint, a score sheet | The log | Yes |
| [What one page runs for everybody](#what-one-page-runs-for-everybody): enemies, a ball, bots | Messages from the host | No |
| [What each player may see](#what-each-player-may-see): a big world, cards | `room.sendEach` from the host | No |
| [What happened](#what-happened): a shot, a hit, a sound | Messages | No |

Two more cut across these: [who can be counted on](#who-can-be-counted-on), when a member's page is in the
background or its connection is down, and [bytes instead of JSON](#bytes-instead-of-json), for what goes out many
times a second.

## By kind of game

| A game like | What it uses |
|---|---|
| Walking one world together | [What the world is built from](#what-the-world-is-built-from), [where each player is](#where-each-player-is-now), [what a player owns](#what-a-player-owns) (where they stood), [the log](#changes-that-must-be-kept-in-one-order) for what is picked up, [the host](#what-one-page-runs-for-everybody) for the animals |
| Driving one road together | [What the world is built from](#what-the-world-is-built-from), [where each player is](#where-each-player-is-now), [what a player owns](#what-a-player-owns) (where they were) |
| Building a world that is still there next week | [The log](#changes-that-must-be-kept-in-one-order) with snapshots, [what a player owns](#what-a-player-owns), [where each player is](#where-each-player-is-now), [the host](#what-one-page-runs-for-everybody) for the enemies, [bytes](#bytes-instead-of-json) |
| A shooter, together against waves | [Where each player is](#where-each-player-is-now), [the host](#what-one-page-runs-for-everybody) for the horde, [what happened](#what-happened) for the shots, [who can be counted on](#who-can-be-counted-on), [bytes](#bytes-instead-of-json) |
| A match, with bots in the empty places | The same as the shooter, and [the log](#changes-that-must-be-kept-in-one-order) for what stays: paint, tags, rounds |
| One big world, of which each player sees a part | [The host](#what-one-page-runs-for-everybody) for the world, [what each player may see](#what-each-player-may-see), [bytes](#bytes-instead-of-json) |
| A game in turns: chess, noughts and crosses | [The log](#changes-that-must-be-kept-in-one-order) alone: the seats, every move, the next game; [who can be counted on](#who-can-be-counted-on) for the name plates |
| A race on one course: a runner | [What the world is built from](#what-the-world-is-built-from) (the race: a seed and a start on the room's clock), [what happened](#what-happened) (every press, with its step), [the log](#changes-that-must-be-kept-in-one-order) for the results |
| A game in turns with a secret: hidden boards | [The log](#changes-that-must-be-kept-in-one-order), with each secret kept in its own browser and a promise about it in the log (below) |
| Cards dealt face down | [What each player may see](#what-each-player-may-see) |

Every one of them also uses what every game does: joining, the members, messages. The examples show some of these
without a game around them: [`turns.html`](../examples/turns.html) a game in turns, [`cards.html`](../examples/cards.html)
cards dealt face down, and [`host-ball/`](../examples/host-ball/index.html) a ball run by the host with a wall kept in
the log. Four more are bare games, tested the way real games of these kinds were:

| Example | Of the kinds above |
|---|---|
| [`world/`](../examples/world/world.js) | Walking one world together, and building in it: a seed the room keeps, where each player stood, the log with packed snapshots, two pages in one room |
| [`arena/`](../examples/arena/arena.js) | The shooter and the match: the host runs the bots and a ball, tells each player what it can see, and goes only for who is here |
| [`duel/`](../examples/duel/duel.js) | A game in turns with a secret: the log alone, each secret in its own browser and a promise about it in the log |
| [`rally/`](../examples/rally/rally.js) | A race on one clock: a ball's flight is a start on the room's clock, and the page it is heading to decides |

## What the world is built from

**A room value**, saved by whoever comes first: `room.offer(channel, value)` saves it only if the room has none,
and answers with the one the room has. Everything the world is raised from goes in it; the world itself does not.
For a world raised from a seed under a sky that turns: the seed, and the server time at which its day stood at
zero. Read the day off `room.now()`, and the sky is the same for everybody and goes on turning while nobody is
there.

A page that finds a different world in the room than the one it built reloads into it. That is simpler than
tearing a world down.

## Where each player is now

**Presence**: one small value per member, of which only the latest counts. The server passes changes on twenty
times a second and drops them for a member who is behind; a late position is worth nothing.

- Draw others from [`Smooth`](integrate.md#4-show-the-players-to-each-other), a little in the past, not from what
  arrives.
- A value that does not change is sent once. A page that starts caring about a member late (it learnt only now
  which figure is theirs) reads `room.presence.get(member)` then, rather than waiting for the next change: it may
  never come, and a friend who stands still is then never drawn.

## What a player owns

**A player value**: `room.send(channel, value, { retain: 'player' })`. One per player and channel, kept under the
player's id, so it is still there when they come back another day: what they carry, where they stood last.
Everybody in the room gets everybody's.

Not for secrets: every member's page gets every player's values.

## Changes that must be kept, in one order

**The log**: each change is an op. The server numbers the ops, saves them, and gives them to everybody in the same
order, the sender included. A page that changes its state only when an op comes back has the state everybody has.
Now and then the host replaces the ops so far by a snapshot.

Two players who reach for the same thing: the first op wins on every screen. A game in turns can keep everything in
the log: who sits where, every move, resigning, the next game. Every page checks each op with the game's rules and
ignores one that breaks them (a move out of turn, a second move for the same turn), so every page has the same game
without a host to referee, and the room keeps it, so a game can be played over days.
[examples/turns.html](../examples/turns.html) is that in 100 lines.

- An op made while the connection is coming back waits in the client, and goes when it is back, in order, at a pace
  the server takes. A game needs no list of its own for them. An op already on its way when the connection drops
  may be lost, though: one the server took always comes back through `apply`.
- An op comes back in about a round trip. Show the change at once on the page that made it where you can, and
  skip that op when it returns (`entry.from` is yourself, and `entry.replayed` is false).
- A room's log has a size cap, 1 MB by default, which `room.limits.maxLogBytes` says. A snapshot over it is refused
  with `too-big`. The game can then keep less, and say so in the log, so that every page keeps the same.
- A large save packs to a fraction of its size with `pack`: [When the state is large](integrate.md#when-the-state-is-large).

## What one page runs for everybody

**The host**: one member the server names, the first to join and then the earliest who is here. Its page runs what
must be decided in one place, and sends what it decided as messages, `volatile` when the next one replaces it.

- **Say everything again now and then.** A report that names every unit is also all a newcomer and the next host
  need, down to the enemies still to come.
- **Say when.** A report arrives some milliseconds after it was sent, a different number each time. Send
  `room.now()` with it, and carry what moves on by the report's age, or draw it a little in the past with `Smooth`.
  Drawn as it arrives, it goes back and forth.
- **The next host knows what it was shown, not what the old one had in mind.** Put in the report what a unit is in
  the middle of (roused, charging), or let what cannot be picked up halfway end when the host changes.
- **The host changes** when it leaves, reloads, puts its page in the background, loses its connection for five
  seconds, or stops for three. `room.on('host-change')`: if it is this page now, carry on from what it was drawing.
- **Who it can count on**: see [below](#who-can-be-counted-on). Nothing it runs should wait for, or shoot at, a
  member who is not there to play.

## What each player may see

**`room.sendEach`**: one message from the host with a part for each member, which the server splits. Each member
gets its own part and nothing of the others'. It counts once against the host's rate, so a view for each of
seven guests, twelve times a second, is twelve frames, not eighty-four. For a world too big to send everybody: the
host's page runs it, and tells each guest what is near it. For cards: the host deals each player a card nobody else
sees ([`cards.html`](../examples/cards.html)).

**A secret of a player's own that has to last**, a hidden board or a hand kept for days. p3p2 has no saved value
that only its owner can read: nothing on the server is hidden from the room's other members, and nothing needs to
be. A player is a browser, so the player's own page keeps the secret in the browser's storage, and puts a promise
about it in the log (a hash of the secret and a random salt). Whatever the others need to know (a hit or a miss)
the owner's page answers, as an op, as soon as it sees the question, whether or not its player is at the keyboard.
At the end the page shows the secret, and every page checks it against the promise and the answers. A browser that
loses its storage loses the secret, and the game should say so.

## What happened

**Messages**: `room.send(channel, data)` to the others, the host, or some members. In order from each sender, at
most once, not kept.

- **Fly on every page what can be dodged.** A shot sent as it is fired, and flown on every page from where it was
  fired, is one a player can see coming. The page whose player it reaches judges it.
- **Send what flies with its age**, or its start on the room's clock. A round fired on the host's page reaches a
  guest a tenth of a second later, at the muzzle, unless the guest's page makes up the time it has been flying.

Anything that must not be lost goes into a saved value or the log instead: a message to a page that is
reconnecting is gone.

## Who can be counted on

**`member.state`**: `here`, `away` (its page is in the background) or `lost` (no word from it for three seconds).
A member who is away or lost keeps its place in the room (a lost one for 30 seconds) and can come back as
`here`, but cannot play meanwhile: a browser stops a page in the background, and a page without a connection
cannot be told anything. A player who stands still is not a player who left: a page that is here may say nothing
for a while.
`room.on('member-state', (member, state) => …)` says when it changes.

```js
const targets = room.members.filter((m) => m !== room.self && m.state === 'here')
room.on('member-state', (member, state) => {
  if (state !== 'here') horde.forget(member.id)
})
```

- Enemies and bots go only for players who are `here`. A page in the background is frozen and could not dodge;
  one without a connection could not be told it was hit.
- A game in which everybody waits for everybody (a turn, the start of a race) waits only for members who are
  `here`, or it may wait for good on one who has gone to make tea.
- A host that goes to the background passes the role to a member who is `here`, if there is one.

## Bytes instead of JSON

**Binary messages**: `room.send(channel, bytes)` with an `ArrayBuffer` or a typed array. The others get a
`Uint8Array`; `from`, `to`, `volatile` and the order among a sender's messages are as for JSON. Worth it for what
goes out many times a second: a list of units as numbers is a fraction of the size of the same list as JSON, and
there is no text to parse. A unit of a host's report fits in 16 to 24 bytes.

```js
// Sending: a DataView over a buffer of the right size.
const out = new DataView(new ArrayBuffer(4 + 8 * units.length))
out.setUint32(0, tick)
units.forEach((u, i) => {
  out.setFloat32(4 + 8 * i, u.x)
  out.setFloat32(8 + 8 * i, u.z)
})
room.send('units', out.buffer, { volatile: true })

// Receiving: the bytes are a view into a larger buffer, so read them where they start.
room.on('units', (bytes) => {
  if (bytes.byteLength < 4) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  world.moveUnits(view.getUint32(0), view)
})
```

- **Read from `byteOffset`.** The `Uint8Array` a page gets is a part of the message as it came, header and all:
  `new DataView(data.buffer)` reads the header.
- **Not for what is saved.** Saved values and the log are JSON, and `retain` with bytes throws. Put bytes there as
  base64.
- **Check the length** before reading: what arrives is whatever the other page sent.

## The traps

**Browsers that build different worlds from one seed.** `Array.prototype.sort` with a comparator that draws from
the seeded generator: each engine calls the comparator a different number of times, so Chrome and Firefox build
different worlds and leave the generator in different places. Portals end up somewhere else for each player, and
mazes differ. Shuffle with a fixed number of draws instead. `Math.pow`, `Math.sin`, `Math.hypot` and their kin
differ in the last bit between engines too: fine for drawing, fatal for a simulation every page runs for itself.
Test with Chrome, Firefox and WebKit in one room.

**A world that differs by page for other reasons.** Food that grows on the parts of a world a page has built so far,
which each page builds in its own idle time. A course whose next stage waits until this page's graphics for it are
ready, when the stages decide where the obstacles go. Anything that depends on timing is not "from the seed".

**Two who come first.** Two people who open an empty room at the same moment each find it empty. A world saved
with an ordinary `retain: 'room'` is then whichever came last, and the other has already built on its own, and
perhaps written ops about it. `room.offer()` saves only if the room has none, and tells both what it holds.

**Changes made while the world is handed over.** Between the moment a page takes the save it offers and the moment
the room's log is open, a change applied at once, as the game does alone, is in that page's world and nobody
else's. Hold changes until the log is open, and send them as ops.

**A host in the background.** A browser slows or stops a page in the background. p3p2 passes the host's role on
when its page goes there; the game must carry on from what the next host was drawing.

**Clocks.** `Date.now()` differs between machines by seconds. Use `room.now()`, the server's clock, for anything
two pages must agree on, and send times as server times.

**Ids that collide.** A game that counts its own ids from 1 on every page gives the host's things and a guest's own
things the same numbers. A guest is then told she was eaten by herself. Keep the host's ids and the page's own
apart.

**A page that comes back.** A reload keeps the member, and the room may have it in mind as it was. A page that
starts says so, and whoever keeps something for it starts again: a host that sends each guest what changed sends
that guest everything once more.

**Late joiners.** Whatever a newcomer needs is in a saved value, the log, or the host's next report. Anything that
was only ever a message, it never gets.

**A long log taken in at once.** A newcomer is handed every op since the last snapshot. If each costs real work
(a mark cut into a mesh of many triangles), applying them all in one go stops the page. Keep the state at once, and
do the drawing a few milliseconds a frame.

**What a friend can cheat.** Everything: each page runs code its player controls. The host's game is the referee,
and the host is one of the friends. p3p2 is for playing with people you would hand a pack of cards to.
