# The client, call by call

`@p3p2/client`, as a game uses it. [integrate.md](integrate.md) shows the calls in the order a game meets them;
this is the list. The types are in `client/src/types.ts`, and a test keeps this page level with them: every member
named there is named here.

```js
import { P3P2 } from '@p3p2/client'        // the entry: under 2 KB, and it loads the rest when a room is opened
import { Smooth } from '@p3p2/client/smooth'
import { pack, unpack } from '@p3p2/client/pack'
```

A game without a bundler takes the one-file build, `dist/p3p2.iife.js` in the package ([integrate.md](integrate.md#1-get-the-client-into-the-game) has its script tag), and finds `P3P2` at `window.P3P2`, with `P3P2.Smooth`, `P3P2.pack` and `P3P2.unpack` on it, as [`examples/duel/`](../examples/duel/index.html) does.

Four bare games in `examples/` use these calls as real games did, and are tested for it:
[`world/`](../examples/world/world.js), [`arena/`](../examples/arena/arena.js), [`duel/`](../examples/duel/duel.js) and
[`rally/`](../examples/rally/rally.js). The rows below link to them.

## `P3P2`

```js
const p3p2 = new P3P2({ game: { id: 'my-game', version: '1.4.0' } })
```

**Options** (`P3P2Options`)

| | |
|---|---|
| `game` | `{ id, version }`. `id`: 1 to 64 letters, digits, `_ . -`. `version`: 1 to 32 characters without spaces. The server keeps players on different versions apart, by the room's rule. |
| `ui` | The built-in panel (`UiOptions`), or `false` for a game that brings its own menu and uses the API alone ([rally](../examples/rally/rally.js)). |
| `ui.corner` | Where the panel sits: `'top-right'` (the default), `'top-left'`, `'bottom-right'`, `'bottom-left'`. |
| `ui.button` | `false`: no multiplayer button. The game opens the panel with `p3p2.open()` from a button of its own ([duel](../examples/duel/duel.js)). |
| `ui.chatKey` | The key that opens chat while a room is open; `'Enter'` by default, `false` for none ([world](../examples/world/world.js): `'t'`). |
| `urlParam` | The query parameter that carries the invite: `room` by default. With another, the room's owner sets the same one as the room's **Invite parameter** in the portal, for the links it shows. |

**Joining, leaving**

| | |
|---|---|
| `p3p2.start()` | Call once when the game starts. Back into the room after a reload; "Join?" for a page opened from an invite. On an ordinary visit it resolves to `null` at once and loads nothing. Resolves to the `Room`, or `null`. |
| `p3p2.resume()` | The first half of `start()`: back into this tab's room after a reload, without asking. |
| `p3p2.invite` | The invite in the page's address (`{ server, code }`), or `null`. No network. A link from a server's front page may leave the code's last characters out: `code` then ends in a dash for each (see below). |
| `p3p2.peek(invite)` | Who is behind an invite, without joining: `{ roomName, hostName, members, maxMembers }`. For a game that asks "Join?" in its own words ([rally](../examples/rally/rally.js)). |
| `p3p2.join(invite, options)` | Joins through an invite. `options.ask`: ask the player in the panel first (default: when the panel is on). `options.name`: the player's name. Resolves to `null` if the player chose to play alone. |
| `p3p2.open()` | Opens the panel. |
| `p3p2.room` | The room the player is in, or `null`. |
| `p3p2.options` | The options it was made with. |
| `p3p2.on('room', room => …)` | A room started: joined, or back after a reload. A room already open is reported at once. Returns a function that stops listening. |
| `p3p2.on('leave', reason => …)` | The room is over for this player. `reason`: `'left'`, `'kicked'` (by the room's owner, in the portal), `'ended'` (likewise), `'replaced'` (the same player opened it in another tab) or `'lost'` (the connection could not be restored). |
| `P3P2.fromUrl(param, href)` | The invite in an address, read with a parameter name. |
| `P3P2.isTyping` | True while the player is typing in the panel: for a game that listens to keys in the capture phase. |
| `P3P2.local(name)` | A room of one, in the page, that talks to no server: the same code alone and with friends. |

Errors that these reject with carry a `code` next to the message (`P3P2Error`): `unreachable`, `mixed` (an https
page and an http server), `origin` (the room does not allow this site), `auth` (the invite expired, or the
characters put in for the dashes are wrong), `hidden` (the code still ends in dashes), `full`, `name` (a member of
the room has that name already, whatever its capitals), `rate` (too many tries, from this address or for the room),
`proto`, `player`, `version`.
[`examples/rally/`](../examples/rally/rally.js) says each in its own words.

A link from a server's front page may leave the code's last characters out, for the player to type: `p3p2.invite`
is then `{ server, code: '789xyz----' }`. The panel asks for them. A game with its own *Join?* asks, and puts them in
place of the dashes before `peek` or `join`:

```js
const invite = p3p2.invite
const missing = invite?.code.match(/-+$/)?.[0].length ?? 0      // how many to ask the player for
if (invite && missing) invite.code = invite.code.slice(0, -missing) + (await askThePlayer(missing))
```

## `Room`

**Who is here**

| | |
|---|---|
| `room.name` | As the owner named it in the portal. |
| `room.server` | The server's address. |
| `room.self` | This player, as a `Member`. |
| `room.members` | Everybody in the room, `self` included, in the order they joined. |
| `room.host` | The member who runs what must run once, or `null`. The first to join, then the earliest who is `here`. |
| `room.isHost` | Whether that is this player. |
| `room.limits` | What the server takes, in bytes: `maxFrameBytes`, and `maxLogBytes`, how large the room's log may grow. `Infinity` where the server does not say. |
| `room.inviteUrl` | The link to share, or `null` when this player has none. |
| `room.status` | `'open'`, `'reconnecting'` or `'closed'`. |

**A `Member`**

| | |
|---|---|
| `member.id` | Unique in the room for as long as the member stays, reloads included. |
| `member.pid` | The player's id on this server: the same on every visit from the same browser. |
| `member.name` | As they gave it. |
| `member.order` | The order of joining. ([world](../examples/world/world.js): who moves the cellar's creature.) |
| `member.rtt` | Round trip to the server in ms, or `null` until measured; updated every 5 s ([rally](../examples/rally/rally.js)'s menu shows it). |
| `member.state` | `'here'`, `'away'` (the page is in the background) or `'lost'` (the connection is down, or nothing came from it for 3 s). Your own is always `here`. |

**Messages**

| | |
|---|---|
| `room.send(channel, data, options)` | Sends JSON, or binary data (an `ArrayBuffer` or a typed array, which arrives as a `Uint8Array`: a view into the message as it came, so read it from its `byteOffset`). False if it could not be sent. A channel is a short name of letters, digits and `_ . : -`. |
| `options.to` | `'others'` (the default), `'all'` (the sender too), `'host'`, a member id, or a list of them ([arena](../examples/arena/arena.js): a bot tells the players it caught). |
| `options.retain` | `'room'`: the server keeps the last value of the channel for the room, and gives it to whoever comes later. `'player'`: one value per player, kept under the player's id. `'tail'`: the last 50 messages, while the room is open. Saved values go to everybody, the sender included; `null` clears one. |
| `options.first` | With `retain: 'room'` or `'player'`: save only if there is no value yet. |
| `options.volatile` | May be dropped for a member whose connection is behind: positions and the like. |
| `room.sendEach(channel, parts, options)` ([arena](../examples/arena/arena.js)) | Sends each member binary data of its own, in one message: `parts` is a list of `[member or id, bytes]`. Each member gets its part as an ordinary binary message from this player. It counts once against this player's rate. `options.volatile` as above. |
| `room.on(channel, (data, from, meta) => …)` | Listens to a channel. `from` is the sender (`null` for a room value saved before), `meta` is `{ ts, retained }`: the server's time, and whether it set a saved value. Returns a function that stops listening. |
| `room.retained(channel, of)` | The room's saved value on a channel, or with `{ player: pid }` that player's; `undefined` when there is none. |
| `room.offer(channel, data)` | Saves `data` as the room's value unless there is one, and resolves to the value the room then has. Two players who offer at the same moment get the same answer ([world](../examples/world/world.js): its seed; [rally](../examples/rally/rally.js): the sides). |
| `room.now()` | The server's clock, epoch ms: the same for everybody, give or take the network ([rally](../examples/rally/rally.js): a ball's flight). |

**The room's own events** (`room.on(event, …)`)

| | |
|---|---|
| `'member-join'` | `(member)` |
| `'member-leave'` | `(member, reason)`: `'left'`, `'timeout'` (gone for 30 s) or `'kicked'`. |
| `'host-change'` | `(host)`, a member or `null`. |
| `'member-state'` | `(member, state)`: a member went to the background, was lost, or is here again. |
| `'latency'` | `()`: the members' `rtt` were updated. |
| `'status'` | `(status)` |
| `'error'` | `({ code, message })`: the server refused something, and the room stays open. `too-big` (a value or an op over its cap), `rate`, `forbidden`, `seq`. |
| `'close'` | `(reason)`, as `p3p2.on('leave')` ([rally](../examples/rally/rally.js) says why). |

**Leaving**

| | |
|---|---|
| `room.leave()` | Leaves now. Removing a player and ending the game are the room's owner's, in the server's portal. |

## `room.presence`

Where each member is right now: one small value per member (at most 1 KB of JSON), of which only the latest
counts.

| | |
|---|---|
| `presence.set(value)` | Sets this member's value. Call it as often as you like: at most 20 a second are sent, and never the same value twice. `null` clears it. |
| `presence.get(member)` | A member's latest value (by member or id), or `undefined`. |
| `presence.at(member)` | When the server got another member's latest value, on the `performance.now()` clock: for `smooth.set` with a value read by `get`, as when a page comes into a room where people are standing still. |
| `presence.on((member, value, at) => …)` | Another member's value changed; `null` when they cleared it. `at` is when the server got the value, on the `performance.now()` clock: give it to `smooth.set`. Returns a function that stops listening. |

## `room.log`

State built from many small changes that has to outlive the players. Each change is an op; the server numbers
them, saves them, and gives them to everybody in the same order, the sender included.

| | |
|---|---|
| `log.open(reader)` | Starts reading, once per room. Resolves when everything saved has been handed over. |
| `reader.load(state)` | The state to start from: the last snapshot, or `undefined`. May return a promise; no op is handed over until it settles. Called again if the log has to be read from the start after a long gap. |
| `reader.apply(op, entry)` | Every op after that state, in order. `entry` is a `LogEntry`. |
| `reader.save()` | The state as it is now, as JSON, for a snapshot. Called on the host when the server asks for one. May return a promise. |
| `log.submit(op)` | Sends an op. It takes effect when it comes back through `apply`. While the connection is coming back the op waits, and goes when it is, in order: at most 60 at once, then 45 a second, which a server with the default settings takes, and ops submitted meanwhile go after them. False if it never will: the room is closed, the op is too big, or 256 are waiting. An op on its way to the server when the connection drops may be lost, and nothing says so; one the server took always comes back through `apply`. |
| `log.snapshot(state)` | For the host: saves `state` (or what `save()` returns) in place of the ops so far. |
| `log.seq` | The number of the last op handed to `apply`. |

**A `LogEntry`**: `seq` (its number), `op`, `pid` (the player who sent it), `from` (the member, or `null` for an op
from before this page was in the room), `ts` (the server's time when it was taken), and `replayed` (true for an op
that was saved before this page got it).

## `room.chat`

| | |
|---|---|
| `chat.messages` | Recent messages, oldest first: `{ from, pid, name, text, ts, self }`. |
| `chat.send(text)` | |
| `chat.on(message => …)` | Each new message. Returns a function that stops listening. |

## `Smooth`

Things that report where they are a few times a second, drawn at sixty: each is drawn a little in the past, between
two reports. [`examples/arena/`](../examples/arena/arena.js) draws the others' figures with it.

| | |
|---|---|
| `new Smooth(options)` | `delay`: how far in the past, ms (120). `coast`: how long a thing carries on the way it was going when no report comes, ms (0: it stands at the last report, and is only ever drawn between reports). `angles`: the positions of angles among the values, which turn the short way round. `quaternions`: the positions of the first of four values that are a rotation. `jump`: a change larger than this is a jump, with nothing drawn in between. `clock`: the clock read when no time is given (`performance.now`; for tests). It also draws further back by how late dated reports arrive, the most in the last second. |
| `smooth.set(key, values, at)` | A report: an array of numbers, made at `at` on the `performance.now()` clock (now by default). For presence, the `at` that `presence.on` gives. |
| `smooth.get(key, now, out)` | The values to draw with now, or `null`. |
| `smooth.has(key)`, `smooth.delete(key)`, `smooth.clear()` | |

## `pack` and `unpack`

[`examples/world/`](../examples/world/world.js) packs its snapshots, and keeps the newest walls that fit.

| | |
|---|---|
| `await pack(value)` | Any JSON value as a string, several times smaller for text that repeats itself, as saved game state does. |
| `await unpack(packed)` | The value back. Anything that is not a packed value comes back as it is. |
