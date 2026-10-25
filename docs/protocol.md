# p3p2 protocol 1

How a game (through `@p3p2/client`) talks to a p3p2 server. The executable form of this
document is `protocol/src/`: the types, and the validators both sides run.

Status: **frozen as protocol 1** on 2026-10-11, after seven games were built on it; five more since, which asked
only for what may change within it. Everything described here is implemented. What may still change without a new number is in [Changes within protocol 1](#changes-within-protocol-1).

- The server is **generic**. It reads the envelope of each message (`t`, `ch`, `to`, flags) and
  never looks inside `data`. [design_philosophy.md](design_philosophy.md) says how it stays so, and
  what that leaves out.
- The server is **untrusted** from the game's point of view. The client validates every frame,
  never runs anything the server sends, and shows names and chat as plain text.

## The two links

| Link | Looks like | Who has it | What it allows |
|---|---|---|---|
| Room URL | `https://p3p2.example.com/room/<key>` | The owner: it is the room's page in the portal | Hosting: create and renew the invite, kick, end the session. Clients from 0.2 on never use it |
| Invite link | `https://game.example.com/?room=p3p2.example.com/<code>` | Everyone the owner sends it to, the owner too | Joining |

- `<key>` is 26 characters of Crockford base32 (130 random bits). It lasts until the owner
  rotates it or deletes the room.
- `<code>` is 10 characters of Crockford base32 (50 random bits). It stops working 12 hours
  after the room empties, or when it is renewed or the session is ended.
- The invite link is the game's own address plus one query parameter, `room` unless the game
  picks another name. Its value is `<server>/<code>`. `https://` is left out; any other scheme
  is written out, as in `?room=http://192.168.1.118:8080/789xyz0abc`.
- On a server's front page a room's link may leave the code's last characters out, a dash in place of each:
  `?room=p3p2.example.com/789xyz----`. At least two characters are the code's. The client asks the player for the
  rest, and puts them in before it sends the code: the server only ever gets whole codes.
- A code is a **try** for each room whose front-page link leaves characters out, and whose current invite has the
  characters the link shows, as the code does. Each such room takes 10 wrong tries, through `GET /invite` and
  `hello` together, then one every 6 minutes. With none left, every try for the room is refused with `rate`, the
  right code included. A member coming back with its resume token is not a try.
- A room accepts requests only from its game's origin, plus origins the owner added.

## REST API

Base: `<server>/api/v1`. Secrets travel in `Authorization: Bearer …`, never in the URL. Cookies
are not used.

| Method | Path | Bearer | Answer |
|---|---|---|---|
| GET | `/info` | none | `{name, version, protocols: [1], limits: {maxFrameBytes, msgRate, maxMembers}, source}` |
| GET | `/room` | room key | `{name, game: {url}, maxMembers, members, invite?: {code, expiresAt}}` |
| POST | `/room/invite` | room key | `{code, expiresAt}`: the current invite, or a new one |
| GET | `/invite` | invite code | `{room: {name}, hostName, members, maxMembers}` |
| GET | `/stats` | stats token | The server in numbers; see "Stats" |
| GET | `/healthz` (not under `/api/v1`) | none | `200 ok` |

`POST /room/invite` takes an optional JSON body:

- `renew: true` revokes the current code and issues a new one. Members stay connected.
- `page` and `param`: the game page's address and the game's parameter name, so the portal can
  show the same invite link and QR code. `page` is ignored unless its origin is one of the room's.

A body larger than 64 KB is not read, and counts as an empty one.

`expiresAt` is epoch milliseconds, or `null` while the room has members.

Errors are `{error, message}` with one of these codes:

| Status | `error` | Meaning |
|---|---|---|
| 401 | `auth` | Unknown room key; unknown, expired or revoked invite; wrong stats token |
| 403 | `origin` | The request's `Origin` is not one of the room's origins |
| 404 | `not-found` | No such endpoint |
| 429 | `rate` | Too many requests from this address; or, from `GET /invite`, too many wrong tries for the room (see "The two links") |

**CORS.** `/info` answers every origin. For the other endpoints the server reflects `Origin`
only when *some* room accepts it; a preflight carries no credentials, so it cannot be checked
against one room. The request itself is then checked against its own room. An origin no room
accepts gets `403` without CORS headers, which a browser reports as a network error; the client
tells this apart from a dead server by calling `/info`.

**Stats.** `GET /stats` is not for game pages: it answers whoever holds the server's
`P3P2_STATS_TOKEN`, sends no CORS headers, and does not exist on a server without a token.
It is what the load generator in `bench/` reads.

```jsonc
{"now": 1760000000000, "uptime": 3600.5,          // server clock, epoch ms; seconds since the start
 "version": "0.1.2", "node": "v24.18.0",
 "cpu": {"user": 41250, "system": 9800},          // CPU time used so far, ms
 "memory": {"rss": 99123200, "heapUsed": 15728640, "heapTotal": 20971520, "external": 2097152},  // bytes
 "loop": {"p50": 0.1, "p99": 1.2, "max": 8.4},    // how late the event loop ran, ms
 "rooms": 1, "members": 20, "connections": 20,    // live rooms, their members, open WebSockets
 "framesIn": 720000, "framesOut": 1440000,        // totals since the start, like all that follow
 "bytesIn": 70000000, "bytesOut": 830000000,      // WebSocket bytes on the wire
 "presenceOut": 1400000, "presenceSkipped": 0,    // presence batches sent; receivers passed over for being behind
 "volatileDropped": 0,                            // volatile messages not sent to a receiver that was behind
 "rateDropped": 0,                                // frames refused for coming faster than the rate limit allows
 "kinds": {"msg": {"frames": 9000, "bytes": 800000},   // what was received, by kind of frame; "bin" is a
           "bin": {"frames": 0, "bytes": 0},            // message with a binary payload, "other" all that a
           "pres": {"frames": 700000, "bytes": 68000000},   // game does not send itself (hello, ping, away)
           "op": {"frames": 400, "bytes": 30000}, "snap": {"frames": 2, "bytes": 32000},
           "other": {"frames": 10598, "bytes": 1138000}},
 "writes": 420}                                   // write statements run on the database
```

- The share of a CPU between two readings is the difference in `cpu.user + cpu.system`
  over the difference in `uptime`.
- `loop` covers the time since the last request with `?reset=1`. Values under about 1 ms are
  the granularity of the timer that measures it.
- `members` includes members in their grace period, so it can exceed `connections`.

## WebSocket

`<server>/api/v1/ws`, with `http` → `ws` and `https` → `wss`. Frames are JSON text, one object per
frame, with the frame type in `t`. The one exception is a message with a binary payload, which
travels as a binary frame (see "Binary messages").

The handshake is refused with `403` when the `Origin` header is not accepted by any room, and
with `429` when one address connects too often.

### Joining

The client sends `hello` within 5 seconds. The server answers `welcome`, or `error` and closes.

```jsonc
// client → server
{"t": "hello", "proto": 1,
 "auth": {"key": "<room key>"},            // or {"invite": "<code>"}
 "player": {"pid": "…", "secret": "…"},    // 16–64 characters of A–Z a–z 0–9 _ -
 "game": {"id": "my-game", "version": "1.0.0"},
 "name": "Ada",
 "resume": {"member": 3, "token": "…",     // optional, see "Coming back"
            "lastSeq": 41}}                // optional: the last op of the log this client has

// server → client
{"t": "welcome",
 "self": {"id": 3, "pid": "…", "name": "Ada", "order": 3, "mod": false},
 "room": {"name": "Friday games"},
 "host": 1,
 "members": [{"id": 1, "pid": "…", "name": "Grace", "order": 1}, …],   // includes self
 "states": [[2, "lost"]],                  // the members that are not "here"; see "Members and host"
 "retained": {"room": {"world": {…}},      // retain: 'room', by channel
              "player": {"<pid>": {"pos": {…}}},   // retain: 'player', by player id and channel
              "tail": {"$chat": [{"from": 1, "pid": "…", "name": "Grace", "data": "hi", "ts": 1760000000000}]}},
 "presence": [[1, {…}, 1760000000000], …],  // the other members' presence: [member id, value, when the server got it]
 "log": {"snap": {"upTo": 40, "data": {…}},   // the room's log, see "The log"
         "ops": [{"seq": 41, "pid": "…", "op": {…}, "ts": 1760000000000}]},
 "limits": {"maxFrameBytes": 65536, "maxLogBytes": 1048576},   // the largest frame; the room's log at most
 "token": "…",                             // for resume
 "now": 1760000000000}                     // server clock, epoch ms
```

- **Auth.** A room key makes the member a *mod* (`self.mod`): it may `kick` and `end`. An invite
  code only lets it join. Clients from 0.2 on join with invites only, the owner too, who removes players and ends
  the session in the portal. The key is for the clients before them.
- **Origin.** The handshake's `Origin` must be one of the room's origins.
- **Player id.** `pid` is a random id the client keeps per server, with a secret. The server
  registers the pair the first time it sees the `pid` and afterwards accepts that `pid` only
  with the same secret. It is not a login; it keeps one player from posing as another. A `hello`
  with the `pid` of a member already in the room takes that member over, as a resume does, without
  its token: another tab of the same browser. The older connection is told `bye replaced`, and the
  others hear of nothing. One player is one member of a room. When the older connection was still
  open and held the host role, the role passes on, as at a reload: the newer page has none of the
  older one's game.
- **Name.** Cleaned by the server: only letters (with their marks) and digits of any script,
  spaces and `. - _ '`, single spaces, at most 24 characters, and at least one letter or digit.
  An empty name becomes `Player <n>`, with the member's id for `n`, or the next number nobody's
  name has. A name a member of the room already has, compared after NFKC and in lower case, is
  refused with `error name`. Members in their grace period count.
- **Members.** `id` is unique in the room while the member stays. `order` is the order of
  joining.
- **Host.** The first to join. See "Members and host" for when the role passes on.
- **Limits.** A frame larger than `limits.maxFrameBytes` closes the connection, so a client
  does not send one. `limits.maxLogBytes` is how large the room's log may grow, snapshot and ops
  together; a server from before it sends none.
- **The game.** A room is held to the `game.id` it was first played with, and a member of
  another game is refused with `error game`, whatever its origin: another game on the same
  site would read a log and values that are not its own. The owner can let another game in
  from the portal, and "Clear saved data" does it too. A game whose parts are several pages
  gives every page the same id.
- **Game version.** `game.version` is compared with the version of the members already in the
  room, and a member that differs is refused with `error version`. An empty room takes whatever
  version comes first. The owner sets the policy per room: the versions must be equal (the
  default), must have the same first number (the part before the first `.`), or are not compared.
  A member that resumes is checked like one that joins, against the others.

### Messages

```jsonc
// client → server
{"t": "msg", "ch": "pos", "data": <any JSON>,
 "to": "others",        // optional: "others" (default) | "all" | "host" | <member id> | [<member id>, …]
 "volatile": true}      // optional
{"t": "msg", "ch": "world", "data": <any JSON>,
 "retain": "room",      // optional: "room" | "player" | "tail"; not with "to", see below
 "first": true}         // optional, with retain "room" or "player": only if nothing is saved there yet

// server → client
{"t": "msg", "from": 3, "ch": "pos", "data": <the same JSON>, "ts": 1760000000000,
 "retain": "room"}      // "room" or "player"; present only for saved values
```

- **Channels** are names of 1–32 characters from `A–Z a–z 0–9 _ . : $ -`. Names starting with
  `$` belong to the client library; `$chat` is the built-in chat, whose `data` is a string.
- **Routing.** `"all"` includes the sender. Ids that are not in the room are skipped. At most
  64 ids.
- **`retain: "room"`** saves the message as the room's value for that channel, on disk. It
  replaces the previous one. It is delivered to **all** members, the sender included, so every
  member applies room values in the one order the server saw them; `to` must be absent or
  `"all"`. `data: null` clears the value.
- **`retain: "player"`** does the same with one value per player and channel: the sender's. The
  value belongs to the sender's `pid`, not to its member id, so it is still there when the
  player has left, and when they come back another day. Receivers learn whose value it is from
  `from`. `welcome.retained.player` holds the values of every player who ever saved one in the
  room, present or not.
- **`first`** makes a saved value one that whoever comes first decides, like the seed of a
  world. With it the message is saved, and sent to all, only if the channel has no value yet:
  for the room with `retain: "room"`, for the sending player with `retain: "player"`. If there
  is a value, nothing changes and nobody else hears of the attempt. The sender alone is sent
  the value that is there, as a `msg` with `retain` and with the time it was saved as `ts`. For
  a room value its `from` is `0`: nobody who is here. So the sender's next saved value on that
  channel is the answer either way, and two members who try at the same moment get the same
  one. `first` cannot be combined with `data: null`.
- **Size cap.** The saved values of a room, of both kinds together, are capped (256 KB by
  default). Saved values stay until they are cleared with `null`, or the owner clears the
  room's saved data or deletes the room, with one exception: when a value does not fit, the
  server makes room by forgetting players who are **not in the room**, whoever was there
  longest ago first, and tells the members, who hold copies:

  ```jsonc
  {"t": "forget", "pid": "…"}      // every saved value of this player is gone
  ```

  A player who is in the room is never forgotten. A message that still does not fit gets
  `error too-big`, and is neither saved nor relayed.
- **`retain: "tail"`** keeps the last 50 messages of the channel in memory while the room has
  members, within a byte budget shared by the room's channels (64 KB by default). They arrive in
  `welcome`. The client library's chat is such a channel: after a gap in the connection, the chat
  lines in the `welcome` that the page had not had are handed to it then, its own included.
- **`volatile`** marks a message that may be dropped for a receiver whose connection is behind.
  It is ignored together with `retain`.
- **Delivery.** In order per sender, at most once. Nothing is replayed after a reconnect; state
  that must not be missed belongs in `retain` or in the log.

### Binary messages

For payloads that are not JSON, such as a packed snapshot. A binary WebSocket frame holds:

| Bytes | |
|---|---|
| 2 | The header's length in bytes, big-endian. At most 2048. |
| that many | The header: JSON text in UTF-8 |
| the rest | The payload. The server never reads it. |

```jsonc
// header, client → server: a msg without data
{"t": "msg", "ch": "snap", "to": "others", "volatile": true}

// header, server → client; the payload follows, byte for byte
{"t": "msg", "from": 3, "ch": "snap", "ts": 1760000000000}
```

Routing, `volatile`, ordering and the rate limits are those of `msg`, and a binary message keeps
its place among the text frames of the same sender. `retain` is not allowed: saved values are
JSON. A malformed binary frame closes the connection with `error bad-frame`.

**A part for each receiver.** In place of `to`, a header can name the receivers one by one, each
with the length of its part of the payload, in the payload's order:

```jsonc
// header, client → server: 120 bytes for member 3, then 96 for member 5
{"t": "msg", "ch": "view", "parts": [[3, 120], [5, 96]], "volatile": true}

// what member 5 gets: an ordinary binary message, with its 96 bytes as the payload
{"t": "msg", "from": 2, "ch": "view", "ts": 1760000000000}
```

- Each member gets its own part and nothing of the others'; it cannot tell the message had other
  parts. A member who is not in the room is skipped.
- The frame counts **once** against the sender's rate, and with all its bytes against its byte rate.
  This is for a host that tells each player what that player can see, ten times a second: one
  message per guest would be ten frames a second per guest, and the rate is 90 for all of them.
- At most 64 parts, each member at most once, and the lengths must add up to the payload
  (`error bad-frame` and the connection closed otherwise). A part may be empty.

### Presence

Where each member is right now: one value per member, of which only the latest counts.

```jsonc
// client → server
{"t": "pres", "data": <any JSON>, "at": 1760000000000}   // null clears it; "at" is optional

// server → client: what changed since the last batch
{"t": "pres", "list": [[3, {"x": 4, "z": 9}, 1760000000000], [5, null]]}   // [member id, value, at]; null: cleared
```

- `at`, from the client, is when the game set the value, on the server's clock as the client
  reads it (`now` in `welcome`, then `pong`). The server takes it if it is no later than now, no
  more than a second before, and not before the member's previous value; otherwise the nearest of
  those. Without it, the value's time is when the server got it. An older server ignores it.
- `at`, to the client, is that time. A receiver that draws from presence dates each value by it,
  not by when the batch arrived: the batch is up to a tick late, by a different amount each time,
  and so is the sender's connection. A cleared value has none, and a server older than the field
  sends none: date those by arrival.

- The server keeps the latest value per member and passes changes on in batches: at most one
  `pres` frame per receiver per tick (20 ticks a second by default), without the receiver's own
  value. A value is up to one tick late on purpose. A game that cannot wait sends `volatile`
  messages instead, which are relayed at once.
- Sending the same value again sends nothing.
- A value is at most 1 KB of JSON; a larger one gets `error too-big` and the previous one stays.
- A new member gets the others' current values in `welcome.presence`. So does a member that
  resumes; its own value is kept on the server while it is away.
- A member's presence ends with the member: after `member-`, forget it.
- A receiver whose connection is behind (64 KB queued) is skipped. Once it has caught up it gets
  one frame with every other member's current value, `null` for members that have none.

### The log

For state that is built from many small changes and has to outlive the players: a world of
placed blocks, a board, a score sheet. Each change is an **op**. The server gives every op the
next number, saves it, and sends it to everyone in that order. Now and then the host replaces
the ops so far by a **snapshot** of the state they led to, so the log stays short.

```jsonc
// client → server
{"t": "op", "op": <any JSON>}
{"t": "snap", "data": <any JSON>, "upTo": 41}     // host only

// server → client
{"t": "op", "seq": 42, "from": 3, "op": <the same JSON>, "ts": 1760000000000}
{"t": "snap"}                                     // to the host: the log has grown long, send a snapshot
```

- **Ops.** `seq` starts at 1 and goes up by one per op, for as long as the room has saved data.
  An op goes to **all** members, the sender included, so a game that changes its state only
  when an op arrives has the same state everywhere.
- **Snapshots.** `data` is the state after the ops up to and including `upTo`. It takes the
  place of those ops and of the snapshot before; ops with higher numbers stay. `upTo: 0` is a
  state to start from, before any op. Only the host may send one (`error forbidden`
  otherwise). `upTo` must not be lower than the last snapshot's, nor higher than the last op
  (`error seq`). Nobody is told: the members have applied those ops already.
- **In `welcome`.** `log.snap` is the last snapshot as `{upTo, data}`, or `null` when there is
  none. `log.ops` are the ops after it, oldest first. An op there carries `pid`, the player who
  sent it, instead of `from`: member ids do not outlive a visit.
- **After a gap.** A client that reconnects says in `hello.resume.lastSeq` which op it has
  last. If it resumes as the same member and the log still holds what follows, `welcome.log`
  is `{"ops": […]}` with the ops it missed and **no `snap` key**: carry on. Whenever `snap` is
  there, even as `null`, the log is handed over whole: start again from it.
- **Size cap.** The log of a room, snapshot and ops together, is capped (1 MB by default). When
  the ops have used up half of what the snapshot leaves of the cap, the server asks the host
  for a snapshot with `{"t": "snap"}`: once per host, again after a snapshot has arrived, and
  again when the host changes or comes back. An op that does not fit gets `error too-big` and
  is neither saved nor sent on; so does a snapshot that is larger than the cap.
- **Saving.** New ops are written to disk together, four times a second, and when the room
  empties. A server that crashes can lose the last quarter of a second of ops. The members
  then join a room whose log ends earlier than theirs, and get it whole.
- **One frame each.** An op or a snapshot is one frame of JSON, so neither can be larger than
  the server's frame limit (64 KB by default), and neither can be a binary frame. A game whose
  state outgrows a frame needs a server with a larger `P3P2_MAX_FRAME_BYTES`.

### Members and host

```jsonc
// server → client
{"t": "member+", "id": 4, "pid": "…", "name": "Edsger", "order": 4}
{"t": "member-", "id": 4, "reason": "left"}       // "left" | "timeout" | "kicked"
{"t": "host", "id": 2}
{"t": "state", "id": 4, "state": "lost"}          // "here" | "away" | "lost"; not sent to member 4
{"t": "members", "rtt": [[1, 23.4], [2, 61.0]]}   // every 5 s: round trips to the server, ms

// client → server
{"t": "away", "away": true}     // this page went to the background; false: it is in front again
```

**Member states.** Every member is in one of three states, and the others are told with `state`
when it changes. A member that joins is `here`; `welcome.states` lists those that are not.

| State | Means |
|---|---|
| `here` | Connected, its page in front, and heard from in the last 3 seconds |
| `away` | Its page is in the background: it said `away` |
| `lost` | Its connection is down, or it has sent nothing for 3 seconds with its page in front: a page that froze, a laptop whose lid was shut, a connection that died without closing |

A page in front sends something at least once a second. When it has nothing else to send, that
is `{"t": "away", "away": false}` again; the client library does it. A page in the background
is not expected to: a browser may run it once a minute. The state is about now: a `lost` member
keeps its place for the 30 seconds of "Coming back", and is `here` again with its next frame.

A game with bodies in it uses this for whose body nothing should wait for, or shoot at. It is
also how the host role is decided.

**The host** is the member a game can put in charge. The first to join is the host, and stays
the host until one of these happens:

- it leaves, is kicked, or its place times out;
- its connection has been gone for 5 seconds;
- it is connected with its page in front, and has sent nothing for 3 seconds: its page has
  stopped;
- it says `away`. The client library sends `away` when the page has been hidden for a second:
  a browser slows a page in the background down, or stops it. It also sends it at once when
  the page is closed, reloaded or left for another (`pagehide`): whatever the host kept in
  that page has gone with it, so a reload comes back as the same member without the role.

The role then passes to the member that joined earliest among those that are `here`, or failing
that among those that are `away`. If nobody is better placed than the host, the host stays. The
role does not pass back when the old host returns. A new connection counts as in front until it
says otherwise.

### Coming back

A member whose connection drops keeps its slot for 30 seconds. The others are told that it is
`lost`, and nothing more until it is back or gone. If it says
`hello` again with `resume: {member, token}` in that time, it is the same member again: same
`id`, same `order`. This is what a page reload does. A resume also takes over a connection that
is still open (the old one gets `bye replaced`).

The host role is kept for 5 of those 30 seconds; see "Members and host". After 30 seconds the
others get `member-` with `timeout`. A resume that no longer matches joins as a new member. A
member who joined with an invite that was renewed since can still resume.

What was relayed meanwhile is gone. The log is not: see `lastSeq` under "The log".

### Leaving, and moderation

```jsonc
// client → server
{"t": "leave"}              // leave now, without the 30 seconds
{"t": "kick", "id": 4}      // mods only
{"t": "end"}                // mods only: everyone out, and the invite is revoked

// server → client, followed by the close
{"t": "bye", "reason": "kicked"}   // "kicked" | "ended" | "replaced" | "slow" | "shutdown"
```

`slow` means the member fell too far behind (1 MB queued, not counting what is left to send of
its `welcome`). It keeps its slot and can resume.

### Clock

```jsonc
{"t": "ping", "c": 1234.5}                        // c: any number, echoed back
{"t": "pong", "c": 1234.5, "now": 1760000000000}
```

Every `msg` carries `ts`, the server time when it was relayed. `pres` carries no time.

### Errors

```jsonc
{"t": "error", "code": "rate", "message": "…"}
```

| Code | Connection | Meaning |
|---|---|---|
| `bad-frame` | closed | Not valid protocol 1 |
| `proto` | closed | `hello.proto` is not 1 |
| `auth` | closed | Unknown room key; unknown, expired or revoked invite |
| `origin` | closed | The room does not accept this origin |
| `player` | closed | The `pid` is registered with another secret |
| `full` | closed | The room has its maximum number of members |
| `timeout` | closed | No `hello` within 5 seconds |
| `version` | closed | The room's members run another version of the game |
| `game` | closed | The room is held to another game (another `game.id`) |
| `name` | closed | A member of the room already has that name |
| `rate` | kept | Over the rate limit; the frames were dropped |
| `rate` | closed | In answer to `hello`: too many wrong tries for the room (see "The two links") |
| `too-big` | kept | Saved values or the log over the room's cap, or a presence value over its limit; ignored |
| `forbidden` | kept | `kick` or `end` from a member who is not a mod, or `snap` from one who is not the host |
| `seq` | kept | A snapshot that ends before the last one, or after the last op; ignored |

A frame larger than the server's limit (64 KB by default) closes the connection.

### Limits

Defaults; all can be changed with `P3P2_*` environment variables.

| Limit | Default |
|---|---|
| Members per room | 16 (the owner sets it per room, up to 64) |
| Frame size | 64 KB |
| Frames per member | 90 per second, bursts of 120 |
| Bytes per member | 256 KB per second, bursts of 512 KB, or of one largest frame if that is more |
| Saved values per room (room and player values together) | 256 KB |
| Log per room (snapshot and ops together) | 1 MB |
| Message tails per room | 64 KB, 50 messages per channel |
| Presence | 20 batches per second; 1 KB per value |
| Grace period after a disconnect | 30 s for the slot, 5 s for the host role |
| Silence, connected and in front, before a member is `lost` and a host gives up the role | 3 s |
| Invite lifetime after the room empties | 12 h |
| Wrong tries for a room whose front-page link leaves characters out (fixed) | 10 at once, then 1 every 6 minutes |
| WebSocket connects per address | 40 at once, then 1 per second |
| REST calls per address | 40 at once, then 5 per second |

## What the server promises

| | Promised | Not promised |
|---|---|---|
| **Messages from one sender** | Arrive in the order they were sent, text and binary alike, at most once each | Arrival at all: a member whose connection is down when a message is relayed never gets it; a `volatile` one may be dropped for a member who is behind |
| **Messages from several senders** | Nothing about their order | That two members see them in the same order. Today one server relays them in the order they reach it, so they do; a game that needs one order for everybody uses the log, which promises it. |
| **The log** | One order for everybody, the sender included (`seq`), every op saved before it is sent on, and handed over again after a gap or to a newcomer | That an op survives a server crash in the last quarter of a second before it was written |
| **Saved values** | The latest value of each channel, to everybody who is there and everybody who comes later; one order for the values of a room | Anything about values cleared by the room's cap (see "Size cap") |
| **Presence** | Each member's latest value, to everybody, within a tick of a change | The values in between |
| **The host** | At most one at a time, named to everybody | That the host's page is running: see "Members and host" for when the role passes |
| **The clock** | `now` and `ts` from one clock, the server's | Accuracy better than the network's round trip |

## Old clients

A game ships the client it was built with, and may never be built again. So **a server never stops taking what
a released client sends**: protocol 1, and the REST calls under `/api/v1`. A protocol 2 would be taken beside
protocol 1, by every server from then on, and `/info`'s `protocols` lists every number a server takes. A new
limit, or a lower default, leaves room for everything a released client does on its own.

The other way round is not promised: a game may be newer than the server it meets. A client that uses something
added within protocol 1 looks for it in `welcome` or `/info` first, and a server that takes none of the client's
protocols refuses it with `proto`, which the client tells the player is the server's to fix.

## Changes within protocol 1

Protocol 1 is the number in `hello.proto` and in `/info`'s `protocols`. These may change **within** it, because
what is already there keeps working:

- **A new optional field in a frame the server sends.** The client ignores fields it does not know.
- **A new kind of frame the server sends**, when no client has to answer it. The client ignores frames it cannot
  read.
- **A new optional field in a frame a client sends**, which an older server ignores. The client must then not
  count on it being honoured: the server says what it supports in `welcome` or `/info`.
- **New error codes**, new `bye` reasons, new limits and their default values, and new settings.

These need **protocol 2**, taken beside protocol 1 (see "Old clients"):

- A new kind of frame from the client (a server that does not know it closes the connection), unless the client
  sends it only to a server that has said it takes it.
- A field removed or renamed, a field that becomes required, a value whose meaning changes, a change to the
  binary frame's layout.

**Added within protocol 1 since it was frozen**, each optional both ways:

| When | What | Why |
|---|---|---|
| 2026-10-13 | The time of a presence value: `at` in the client's `pres`, and a third element in each presence entry the server sends | Drawn by when it arrived, a car followed at speed went forward and back by a few tens of centimetres |
| 2026-10-13 | A room held to its game: error code `game` | Another game on the same site read a room's log and values |
| 2026-10-13 | `welcome.limits.maxLogBytes`, the room's log cap | A game that keeps "the newest so many things" learned the cap from a refusal |
| 2026-10-15 | `source` in `/info`: where the server's source code is | The AGPL asks a server that runs changed code to offer its users that code |
| 2026-10-24 | An invite link whose code ends in dashes, and `rate` for too many wrong tries for a room, from `GET /invite` and in answer to `hello` | A server's front page shows a room's link without its last characters, for friends to type; an older client opens such a link as if there were none |
| 2026-10-25 | A `hello` with the `pid` of a member in the room takes that member over | Two tabs of one browser were two players |
| 2026-10-25 | Names keep only letters, digits, spaces and `. - _ '`; error code `name` for a name the room has | Two players could have one name, or one made of lookalike symbols; an older client shows the code |
