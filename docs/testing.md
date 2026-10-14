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

`e2e/tests/helpers.ts` has what the tests share: `createRoom` (logs in to the portal and creates a room),
`host` and `join` (the panel's way in), `phoneContext` and `fingers` (a phone's screen, and real touches, several
at once), `otherEngines` (Firefox and WebKit next to Chrome), and `measure` (what a room sent, from the server's
counters). `e2e/playwright.config.ts` starts the server, and serves the examples on two sites: one that the tests'
rooms are for, and one that no room accepts.

## Ask the page, do not look at it

A test cannot judge a 3D picture, but it can ask the page what it holds. Give the game a small handle on `window`
for its tests (`window.__game`), and compare what the pages say:

- **A fingerprint of the shared state**, the same on every page: what is left to pick up, the scores, a hash of
  the world, the enemies with their places.
- **Places, within a tolerance.** Something another page moves is drawn a little in the past: compare within
  a metre or two, and poll (`expect.poll`) until it holds.
- **A test hook that does what a player would**, faster: a shot fired at a point, an enemy put somewhere. Keep
  them few and close to what the game itself does: a shot fired through the game's own ballistics is judged as a
  real one is.
- **A name no element has.** A page with `<div id="game">` has a `window.game` before the game does, and a test
  that waits for it waits for nothing.

What the tests cannot see, a person must: how it feels to steer, whether a friend's figure moves well, whether
a bot's shot looks fair. Two screens side by side show what one screen alone never does.

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
[sharing-state.md](sharing-state.md#the-traps)). `otherEngines()` starts Firefox and WebKit beside the tests' Chrome,
so that all three can be in one room; compare what each built, a fingerprint of the world or its tiles one by one.
`npx playwright install firefox webkit` in `e2e/` gets the two besides Chrome; a machine that cannot run one leaves
it out.

## Phones

`phoneContext` is a phone's screen with touch instead of a mouse; `fingers` presses, moves and lifts real touches,
several at once: a thumb on a stick while another finger looks. Check that the panel fits the screen, that its
buttons answer a tap, and that the game's own touch controls still work beside it. A real phone is still worth a
look: an emulated one has a desktop's GPU.

## What it costs

`measure(game, players, play)` resets the server's counters, runs `play`, and reports what each player sent and
got a second, frames refused for coming too fast, messages dropped for a receiver that was behind, and database
writes. The numbers also go to `bench/results/games/<game>.json`. A player may send 90 frames a second by default;
[performance.md](performance.md#the-profiles) has what the server carries of each kind of traffic.

## Running them

```sh
npm run e2e                                   # the browser tests: the examples, in real browsers
npm run e2e -- host-ball                      # one file
E2E_PROXY=1 npm run e2e                       # against the server in its container behind Caddy, over https
```
