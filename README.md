# p3p2

Multiplayer for static web games, through a small server of your own.

- **The p3p2 server**: a small self-hosted service. Its owner logs in to a portal and creates
  *rooms*, each for one game. It relays messages between the players in a room and saves what
  the game asks it to keep. It never needs to know what the messages mean.
- **`@p3p2/client`**: a library for static web games, under 2 KB until a room is opened. The player
  pastes a room URL into the game, gets a link (and a QR code) to send to friends, and everyone
  who opens the link plays and chats together.

## In two minutes

**A player** opens a game, presses 👥 (or a button of the game's own), pastes a room URL from the
server's portal, and sends the invite link it gives them. Whoever opens the link is asked *Join?*,
and is in the same game. A reload, a dropped connection, or a phone switching networks comes back
by itself.

**A game** adds a few lines:

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

Beyond that, the server keeps what a game asks it to: a value for the room ("the world's seed"),
one for each player ("their bag"), and a log of changes in one order for everybody ("every block
placed"), still there next week. One player's page is the **host**, for what must run in one
place (enemies, a ball), and the role passes on by itself when that page goes.

**The server** is one Node.js process with SQLite, and Caddy in front of it for HTTPS: one
`docker compose up` on the smallest VPS there is.

## The documents

**For game developers**

| | |
|---|---|
| [integrate.md](docs/integrate.md) | From a single-player game to two browsers in one room, step by step |
| [sharing-state.md](docs/sharing-state.md) | Which state goes where, what each kind of game uses, and the traps |
| [api.md](docs/api.md) | The client, call by call |
| [protocol.md](docs/protocol.md) | The wire format, and what the server promises |
| [testing.md](docs/testing.md) | Several players on one machine, a bad connection, phones, other browsers |
| [security.md](docs/security.md) | What the room key, the invite and the site check protect, and what not |
| [design-philosophy.md](docs/design-philosophy.md) | How p3p2 stays generic, and the kinds of game it is not for |
| [comparison.md](docs/comparison.md) | Other projects like p3p2, and where each parts from it |
| [`examples/`](examples) | A chat page, a small game with a host and a log, cards dealt face down, a game in turns, and four bare games that do what real games do: [a shared world](examples/world/), [an arena](examples/arena/) one page runs, [a duel](examples/duel/) with hidden boards, and [a rally](examples/rally/) with a menu of its own |

**For players, and for whoever runs a server**

| | |
|---|---|
| [play.md](docs/play.md) | You were sent a link |
| [host.md](docs/host.md) | You want to invite friends |
| [self-host.md](docs/self-host.md) | Putting a server on a VPS, backups, moving, removing it all |
| [performance.md](docs/performance.md) | What a server can carry, and what each kind of game costs it |

## Try it on one machine

Needs Node.js 24.

```sh
npm install
npm run build            # the client library, into client/dist
npm run dev              # the server, on port 8080 (prints a setup link the first time)
npm run examples         # in a second terminal: builds world, arena and rally, and serves the examples on port 5180
```

1. Open the setup link the server printed and choose the owner password.
2. In the portal, create a room. As the game URL enter the address you will open the example at,
   for instance `http://192.168.1.118:5180/chat.html`. Copy the room URL.
3. Open that example address, open the 👥 panel, paste the room URL, and press *Create a
   multiplayer game room for my friends*.
4. Open the invite link in another browser profile or a private window, or scan the QR code with
   a phone on the same Wi-Fi.

Use this machine's LAN address everywhere, never `localhost`: the links are built from the
addresses you use, and `localhost` on a phone is the phone.

## Testing on a bad connection

`npm run lag` starts a proxy in front of the local server that adds latency and jitter and can
cut connections:

```sh
npm run lag -- --latency 150 --jitter 50 --drop-every 30    # listens on 8081, forwards to 8080
```

In the game, paste the room URL with port 8081 in place of 8080. The invite link is built from
that address, so the host and every guest go through the proxy.

## Measuring a server

`npm run bench` drives simulated players through a server and reports CPU, memory and latency.
By default it builds the server's Docker image and runs it with one CPU and 512 MB:

```sh
npm run bench                                  # the commands, profiles and options
npm run bench -- run presence                  # 20 players walking in one room, for a minute
npm run bench -- ramp snapshots                # more and more rooms of 20, to find the limit
npm run bench -- all                           # everything in docs/performance.md but the soak
npm run bench -- soak --hours 24               # a day of mixed traffic, a line a minute
npm run bench -- run chat --target local       # without Docker: the server as a process here
```

What the numbers mean, and the ones measured so far, are in
[`docs/performance.md`](docs/performance.md).

## Layout

```
protocol/   message types and validators, shared by server and client
server/     the server: core/ (room rules, no I/O), adapters/, store/, http/ (API + portal)
client/     @p3p2/client: entry, room client, <p3p2-panel>
examples/   example pages (chat, host-ball, cards, turns), four bare games (world/, arena/ and rally/,
            built by Vite, and duel/, from a script tag), a static server for them, and their build
e2e/        browser tests of the examples (Playwright: the installed Chrome, and Firefox and WebKit), the
            client's tests in Node, a test of the client as npm packs it (pack/), and tools/: a server
            for each test, the runs, and lag-proxy.ts
bench/      load generator: traffic profiles, limit search, soak test; results/ holds its output
deploy/     Dockerfile (the image p3p2/p3p2), docker-compose.yml (that image behind Caddy, with
            HTTPS), docker-compose.build.yml (the image built from this checkout), Caddyfiles, and
            DOCKERHUB.md (the image's page on Docker Hub)
docs/       for game developers, for players and for whoever runs a server: see "The documents"
.github/    the checks every push runs, and the release to npm and Docker Hub
```

## Checks

```sh
npm run lint && npm run typecheck && npm test   # unit and integration tests
npm run build && npm run size                   # client bundles, against their size budgets
npm run test:pack                               # the client as npm packs it, in a game's own project
npm run e2e                                     # host and guests in real browsers
npm run e2e:all                                 # that, the measurements, every released client, the published image
```

`npm test` includes the client's own tests (`e2e/node/`): its room code in Node, against a real
server, with connections that are cut on purpose.

`npm run test:pack` installs the packed client in an empty project, type-checks a page against it,
builds that page with Vite, and loads it and the script-tag build in Chrome.

`npm run e2e` is what CI runs. `npm run e2e:all` adds what runs before a release: what the examples cost the server,
every client released on npm against this checkout's server, and this checkout's client against the published
image, with an upgrade of that image's data. [testing.md](docs/testing.md#running-them) has the runs, and how a test
is tagged for them.

`E2E_PROXY=1` runs the browser tests against the setup of `deploy/docker-compose.yml`: the
server in its container behind Caddy, built from this checkout, and every page over HTTPS. It needs Docker, and ports 80
and 443 of this machine:

```sh
E2E_PROXY=1 npm run e2e
```

## Server settings

Environment variables, all optional:

| Variable | Default | |
|---|---|---|
| `P3P2_PUBLIC_URL` | `http://<LAN address>:<port>` | How players reach the server. Room URLs are built from it. |
| `P3P2_PORT`, `P3P2_HOST` | `8080`, `0.0.0.0` | Where to listen |
| `P3P2_DATA_DIR` | `data` | Where the SQLite database lives |
| `P3P2_OWNER_PASSWORD` | | Sets the owner password instead of the one-time setup link |
| `P3P2_NAME` | the public host name | Shown in the portal |
| `P3P2_SOURCE_URL` | this repository | Where the server's source code is: every portal page links to it, and `/api/v1/info` gives it. Whoever runs a changed server points it at the changed source ([self-host.md](docs/self-host.md#if-you-change-the-server)). |
| `P3P2_TRUST_PROXY` | off | Behind a reverse proxy: read the client address from `X-Forwarded-For`. `deploy/docker-compose.yml` sets it. |
| `P3P2_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `P3P2_MAX_ROOMS` | `50` | |
| `P3P2_MAX_MEMBERS` | `16` | Default players per room (the owner can set up to 64 per room) |
| `P3P2_MAX_FRAME_BYTES` | `65536` | Largest message |
| `P3P2_MSG_RATE`, `P3P2_BYTES_RATE` | `90`, `262144` | Per player, per second |
| `P3P2_MAX_RETAINED_BYTES` | `262144` | Saved values, per room |
| `P3P2_MAX_LOG_BYTES` | `1048576` | The log (snapshot and ops), per room |
| `P3P2_PRESENCE_HZ` | `20` | How often changed presence is passed on, per second |
| `P3P2_INVITE_TTL_HOURS` | `12` | Counted from when the room empties |
| `P3P2_GRACE_SECONDS` | `30` | How long a dropped player keeps their place |
| `P3P2_HOST_GRACE_SECONDS` | `5` | How long a dropped host keeps the host role |
| `P3P2_QUIET_SECONDS` | `3` | How long a connected page in front may say nothing before the room is told it is lost, and a host gives up the role |
| `P3P2_CONNECT_RATE` | `1` | WebSocket connects per second from one address, after a burst of 40 times that. Raise it when many players share an address. |
| `P3P2_API_RATE` | `5` | REST calls per second from one address, after a burst of 8 times that |
| `P3P2_STATS_TOKEN` | | 16 characters or more. Whoever sends it may read `/api/v1/stats`: CPU, memory, traffic. Without it there is no such endpoint. |

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how, and which checks to run. A vulnerability is reported privately,
as [SECURITY.md](SECURITY.md) says.

## License

Copyright (C) 2026 Man & Bot.

- `client/`, `protocol/` and `examples/` are under the [MIT License](client/LICENSE): a game can
  bundle the client library and copy from the examples whatever its own license is.
- Everything else, the server included, is under the
  [GNU Affero General Public License, version 3](LICENSE). Whoever changes the server and lets
  people use it over a network has to offer them the changed source.
