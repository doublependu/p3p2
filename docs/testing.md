# Testing a game with friends you do not have yet

A multiplayer game is several browsers, a server, and a network between them that is never as good as the one on
your desk. All three fit on one machine. This is how p3p2's own tests do it; the files named are in this
repository.

## Several players on one machine

**Use another browser, or another profile, not another tab.** Two tabs of one browser are one player to the
server (the same player id), and the second takes the first one's place. Chrome and Firefox side by side, or a
private window, are two players.

**By hand**: `npm run dev` here starts a server on port 8080. In its portal (http://localhost:8080) create a room
for your game's address, paste the room URL into the game, create the invite, and open the invite in the other
browser. A phone on the same Wi-Fi can join too: serve the game on your machine's LAN address
(`vite --host`), and create the room for that address.

**In a test**: Playwright gives each player a browser context of its own, which is a profile:

```ts
const ada = await (await browser.newContext()).newPage()
const grace = await (await browser.newContext()).newPage()
```

**A server for each test.** Every browser in the tests is on 127.0.0.1, and the server's limits are per address:
on one shared server, tests that run at the same time eat into each other's allowance. So each test that asks for
`server` (`e2e/tests/fixtures.ts`) gets one of its own, on a port of its worker's, with the default settings unless
it names others:

```ts
// A spec of e2e/tests/ takes `test` from './fixtures.ts'.
test.use({ settings: { P3P2_MAX_LOG_BYTES: '16384' } })   // a small log, for every test of the file
test.use({ onDisk: true })                                  // a database in a folder, for a restart

test('…', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Friday games', WORLD)
  // …
  await server.restart({ days: 7 })                         // the same folder, a week later
})
```

`server.restart()` stops the server and starts it again on the same folder, as an update does. With `days`, the
server's clock runs that many days ahead (`e2e/tools/later.mjs`, loaded with `node --import`): invites run out, and
what a room keeps "until next week" is tested next week. With `kind: 'checkout'`, a server started from the
published image comes back as this checkout's, on the same data.

`e2e/tests/helpers.ts` has what the tests share: `createRoom` (logs in to the portal and creates a room, with as
many players as you say), `host` and `join` (the panel's way in), `phoneContext` and `fingers` (a phone's screen,
and real touches, several at once), `otherEngines` (Firefox and WebKit next to Chrome), and `measure` (what a room
sent, from the server's counters). The tests' setup (`e2e/setup.ts`) serves the examples on two sites: one that the
tests' rooms are for, and one that no room accepts.

## Ask the page, do not look at it

A test cannot judge a 3D picture, but it can ask the page what it holds. Give the game a small handle on `window`
for its tests (the examples have `window.example`), and compare what the pages say:

- **A fingerprint of the shared state**, the same on every page: what is left to pick up, the scores, a hash of
  the world, the enemies with their places.
- **Places, within a tolerance.** Something another page moves is drawn a little in the past: compare within
  a metre or two, and poll (`expect.poll`) until it holds.
- **A test hook that does what a player would**, faster: a shot fired at a point, a player put somewhere. Keep
  them few and close to what the game itself does: a step taken through the same code as the arrow key is judged
  as a real one is.
- **A name no element has.** A page with `<div id="game">` has a `window.game` before the game does, and a test
  that waits for it waits for nothing.

What the tests cannot see, a person must: how it feels to steer, whether a friend's figure moves well, whether
a bot's catch looks fair. Two screens side by side show what one screen alone never does.

## A bad connection

`e2e/tools/lag-proxy.ts` sits in front of the server and adds latency and jitter, and cuts every connection when
asked:

```sh
npm run lag -- --latency 150 --jitter 50 --drop-every 30    # listens on 8081, forwards to 8080
```

Paste the room URL with port 8081 in place of 8080: the invite is built from that address, so the host and every
guest go through the proxy. In a test, `startLagProxy({ listen: 0, to, latency, jitter })` gives a proxy and its
`drop()`. Test with 150 ms each way and a cut: a page that reconnects must come back to the same game.

## Browsers

Chrome, Firefox and WebKit build different numbers from the same code now and then (see the traps in
[sharing-state.md](sharing-state.md#the-traps)). `otherEngines()` starts Firefox and WebKit beside the tests'
Chrome, so that all three can be in one room; compare what each built, a fingerprint of the world or its tiles one
by one. The tests' setup starts both once before the first test, and installs one that will not start (with what
it needs from the system, in CI); one that still will not start fails the run. Each worker starts its own pair in
the first test that asks for them, so a test with all three engines gives itself 90 s.

## Phones

`phoneContext` is a phone's screen with touch instead of a mouse; `fingers` presses, moves and lifts real touches,
several at once: a thumb on a stick while another finger looks. WebKit with `devices['iPhone 15']` is Safari's
engine on an iPhone's screen. Check that the panel fits the screen, upright and on its side, that its buttons answer
a tap, and that the game's own touch controls still work beside it. A real phone is still worth a look: an emulated
one has a desktop's GPU and a desktop's network.

## What it costs

`measure(server, name, players, play)` resets the server's counters, runs `play`, and reports what each player sent
and got a second, frames refused for coming too fast, messages dropped for a receiver that was behind, and database
writes. With `E2E_RECORD=1` it also writes them to `bench/results/examples/<name>.json`; an ordinary run changes
no file. A player may send 90 frames a second by default; [performance.md](performance.md#the-profiles) has what
the server carries of each kind of traffic.

## The examples' tests

Each example in `examples/` has a spec in `e2e/tests/`, and each spec reaches what real games needed of p3p2: a
host and guests in one state, reloads, a host that leaves, freezes or goes to the background, a server far away
that drops, Chrome, Firefox and WebKit in one room, a phone, what it costs, and a room that is still there another
day. The world, the arena and the rally are Vite projects. The setup builds them with the client under test, in a
folder of their own outside the repository, as a game's own project builds them, and keeps the builds for the next
run. The duel's script tag names jsDelivr, as [integrate.md](integrate.md#1-get-the-client-into-the-game) gives it;
the tests answer that address themselves, with the client under test, and nothing goes to the network.

A test that fails because of a bug in p3p2 that is not fixed yet stays in, marked
`test.fail(true, 'what goes wrong')`. It runs every time, and turns red once the bug is fixed: then the mark goes.

**Tags** in a test's title say where it runs:

| Tag | |
|---|---|
| `@alone` | It times something: it runs after the others, one at a time |
| `@measure` | It measures what a game costs the server: only in `npm run e2e:measure` |
| `@docker` | It needs the published image: only in `npm run e2e:image` |
| `@this-client` | Something only the newest client does: not with the released clients |
| `@this-server` | Something only this checkout's server does: not against the published image |

## Running them

```sh
npm run e2e                     # the main run: everything but the measurements and the image
npm run e2e -- world            # one file
npm run e2e:measure             # the measurements, one at a time
npm run e2e:clients             # the main run with every released client in place of this checkout's
npm run e2e:image               # the main run against the published image, then the upgrade of its data
npm run e2e:all                 # all four, then a table of how long each took
npm run e2e:all -- world        # one example, in all four
E2E_PROXY=1 npm run e2e         # against the server in its container behind Caddy, over https
```

Each runs in two parts: the tests side by side, four at a time, then those tagged `@alone`, one at a time. Both
parts always run, and the command fails if either did.

| Run | Client | Server | Where |
|---|---|---|---|
| `e2e` | This checkout's | This checkout's | Here and in CI, on every push and pull request |
| `e2e:measure` | This checkout's | This checkout's | Here, before a release |
| `e2e:clients` | Each released one: `npm view @p3p2/client versions`, those whose files are the same in one run | This checkout's | Here, before a release |
| `e2e:image` | This checkout's | `p3p2/p3p2:latest`, pulled at the start | Here, before a release |

When CI's `e2e` job fails, what each failed test left, a trace and a screenshot, is the run's `e2e-results`
artifact, kept for 14 days. `npx playwright show-trace <its trace.zip>` opens a trace.

The clients run holds a promise: every newer server takes every client that was released
([Old clients](protocol.md#old-clients)). A new release joins it by itself. `E2E_CLIENT=<tarball>` runs the main
run with any packed client. The image run needs Docker.

Behind the proxy, the specs of the chat, host-ball, cards and turns examples run, against the one server in the
container: a test that needs settings of its own is skipped, and one that restarts its server gets one on this
machine. Caddy serves `examples/` as files, and the specs of the world, the arena, the duel and the rally are
skipped.
