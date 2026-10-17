# Next 3: example games that test p3p2 the way real games use it

Plan 3 is carried out. It built the test suite and changed nothing else: nothing under `client/`, `server/` or
`deploy/` has changed. Two bugs that the examples found in p3p2 are in tests marked `test.fail()`, and everything
else they showed is listed below, for later.

## What was made

**Four examples** in `examples/`, MIT like the rest of the folder, plain JavaScript, with a 2D canvas or the DOM and
nothing to load but the client. Each keeps what its tests read in `window.example`, and each test hook goes through
the code a player's key or finger does.

| Example | What it is | How it gets the client |
|---|---|---|
| `world/` | A yard of 512 × 256 tiles and a cellar under it, two pages of one room, raised from a seed the room keeps. Stones taken and walls built go through the log; snapshots are packed, and the world keeps the newest walls that fit; where each player stood is a player value | Vite, from npm |
| `arena/` | Each player moves a figure of their own; the host runs five bots and a ball, and tells each player what it can see; the round is a room value that outlives its host. Built twice, with two build ids | Vite, from npm |
| `duel/` | Two 6 × 6 boards, five squares hidden on each, probes in turn, answered by the hiding player's page; a SHA-256 promise in the log, revealed and checked by every page at the end | The script tag of `docs/integrate.md`, one classic script |
| `rally/` | One ball between two paddles, its flight a start on the room's clock, decided by the page it is heading to; a menu of its own (`ui: false`) in place of the panel | Vite, from npm |

**The test suite** around them:

- `e2e/tests/fixtures.ts`: a server for each test, on a port of its worker's, with the default settings unless the
  test names others, in memory or on disk (`e2e/tools/server.ts`). `server.restart({ days, kind })` brings it back
  days later (`e2e/tools/later.mjs`, preloaded with `node --import`; the image takes it through `NODE_OPTIONS` and
  a mounted file), or as the other kind.
- `e2e/setup.ts`: starts Firefox and WebKit once and installs one that will not start; packs the client under test
  (the checkout's, or `E2E_CLIENT`); builds the Vite examples with it outside the repository (`examples/build.ts`),
  keyed by the tarball and the sources; serves the two sites (`examples/serve.ts`, now also at `/world/`,
  `/arena/`, `/arena-next/` and `/rally/`); checks that the image is there for the image run.
- `e2e/tools/run.ts`: the runs, in two parts each (side by side four at a time, then `@alone` one at a time), with
  a table of times; `e2e/tools/clients.ts` finds every released client and groups those with the same files;
  `e2e/tools/summary.ts`, a reporter for the table.
- Specs: `world.spec.ts` (25 tests), `arena.spec.ts` (15), `duel.spec.ts` (10), `rally.spec.ts` (14), and
  `upgrade.spec.ts` (1): 65 new tests, 94 in all. The four older examples' specs moved to the fixture: the same
  tests, a few lines each changed.
- `npm run e2e`, `e2e:measure`, `e2e:clients`, `e2e:image`, `e2e:all`; `ci.yml`'s comment on what CI runs.
- Documents: `docs/testing.md` rewritten around a server for each test, the runs, the tags and `test.fail()`;
  links to the examples from `docs/integrate.md` and `docs/api.md` where their calls are; the examples in
  `docs/sharing-state.md`'s "By kind of game", `README.md`, `examples/index.html`; `CONTRIBUTING.md` says when to
  run `npm run e2e:all`, and that it comes before `git tag`, and lists the duel's script tag with the other files
  that name `X.Y`. `.gitignore` leaves out the examples' lockfiles.

## What each example reaches

Every row of plan 3's tables has a test in the main run. The plan's "From" column is in the plan; here, only the
behaviour.

**What every game needs**

| | world | arena | duel | rally |
|---|---|---|---|---|
| An ordinary visit asks no server anything, and loads only the entry | yes, and in Vite's dev server | yes | yes: the script tag and its script | yes, and the panel never |
| Host and guests share one state; a late arrival gets it | yes | yes | yes | yes |
| A reload, of a guest and of the host | where you stood | the round, the place | the seats, the game | the side |
| The host leaves, freezes, or goes to the background | the cellar's mover | all three | | |
| A server far away that drops | ops wait while it is down | yes | a probe waits | the round trips, and the rally comes back |
| Chrome, Firefox and WebKit agree | tile by tile | the round and the bots | the table | the ball |
| On a phone | WebKit's iPhone: in by the link, a tap, the panel | the stick, quick touches, the panel upright and on its side | its own button, a probe in two taps | a finger moves the paddle |
| What it costs the server | yes | yes | yes | yes |
| Coming back another day | a week later, after a restart | | a probe answered three days later | |

**What no test reached before**: `ui: false` (rally), the `game.version` check (arena-next turned away until the
owner allows it), `member.order` (the cellar's mover), the `close` event (rally: `left`, `kicked`, `ended`; world:
`replaced`), `peek()` (rally's "Join?"), `ui.chatKey` (world: T, since Enter builds), the codes `mixed`, `full`,
`rate`, `proto`, `player` and `unreachable` (rally, and `full` in the duel and the world), and in a browser
`Smooth` (arena: a figure at an even speed drawn steadily, never back), `pack` (world's snapshots), `to: [ids]`
(arena's bots), `member.rtt` (rally's menu, at least twice the lag proxy's latency) and the `replaced` reason.

**What later changes must keep**, each as a test that passes today and asserts only what has to stay: a reload in a
full room (duel's room of two, world's household of four); four from one address; eight from one address joining
at once while a phone that dropped comes back (arena); the "Join?" question before and after the click, and a link
to a server that does not answer (world); the largest world, with 64 KB and 1 MB messages, scattered and in rows
(world); a player's own values after 90 days, and the room URL pasted again another day (world); the panel's words
for a server older than the game (`@this-client`).

**Old and new against each other**: the main run with `0.1.0` and `0.1.1` (one group, their files are the same),
and with the published image `0.1.1`; `upgrade.spec.ts` gives the image a world with a snapshot, a duel in progress,
an invite and a room with settings of its own, then opens its folder with the checkout's server: all of it is
there, and every player is the same player.

## Bugs found in p3p2

Each has a test marked `test.fail()` with what goes wrong. Both run in every run, and turn red once fixed.

1. **An op on its way to the server when the connection drops is lost** (`world.spec.ts`, "an op on its way to the
   server when the connection drops is not lost"). The client waits with ops submitted while the connection is
   down, but not with one it has sent and the server has not yet taken: when the connection drops under it, it is
   gone, and nothing tells the game. Through 150 ms of latency it happens every time. A fix needs the client to
   keep each op until it comes back, and the server to know an op it has already taken when it is sent again
   (an id per op, within protocol 1 as an optional field). The same goes for a saved value sent just before a drop;
   `room.send` says false while the connection is down, so a game can at least send that again, as the rally does.
2. **A frame larger than twice `P3P2_BYTES_RATE` is always dropped as over the rate** (`world.spec.ts`, "an op as
   large as a message may be arrives"), however large `P3P2_MAX_FRAME_BYTES` says a frame may be. With 1 MB
   messages and the default byte rate (256 KB a second, 512 KB at once), every op or snapshot over 512 KB is
   refused with `rate`, and `welcome` tells the game only `maxFrameBytes`. The server could refuse such settings at
   start, or raise the byte burst to the frame size; README's table could say it meanwhile. The largest-world tests
   with 1 MB messages set `P3P2_BYTES_RATE` to 1 MB for this reason.

## Improvements and documents, not changed

- **A saved value that changes while a page's connection is down is not handed to the channel's handlers** when it
  is back: `welcome` replaces it, and only `room.retained()` shows it. The rally missed a flight this way, and reads
  the room's values again on `status` `'open'`. `docs/sharing-state.md` says "Anything that must not be lost goes
  into a saved value or the log": true, but a game listening with `room.on(channel)` has to read `retained()` after
  a gap, and no document says so. Either the client calls the handlers for values that changed, or the documents say
  to read them.
- **Keeping the newest that fit** is easy to get wrong, as the world first did (below): a sentence for
  `docs/sharing-state.md`'s log, beside the one `docs/integrate.md` now has.
- **`crypto.subtle` is missing on a page on plain http**, which is how a phone on the same Wi-Fi meets a game. The
  duel carries a SHA-256 of 40 lines. `docs/sharing-state.md`'s "a hash of the secret and a random salt" could say
  where the hash comes from.
- **Packing.** `docs/integrate.md` says a world of blocks "packs to a fifth", `client/src/pack.ts` "a sixth". The
  world writes each wall as the step from the one before, and packs walls laid in rows to a tenth (100,000 walls:
  201,718 bytes of JSON, 19,031 packed) and walls scattered at random to a third (15,315 walls: 180,732 and 61,835).
  Plan 3 guessed a fiftieth and a quarter. Either figure in the documents is fair for some world; "several times
  smaller", as `docs/api.md` says, is the safe one.
- **What the other player sees of a hit.** In the rally, the page a ball is heading to decides, so the other page
  draws the ball on past the paddle until it hears: through 150 ms each way, for 330 ms, and then the ball jumps
  back by about 340 units of an 800-unit court. Nobody loses a point to it, and the two pages read the room's clock
  to within 6 ms. A game would rather hold the ball at the paddle while it waits. That is the example's to change,
  and a sentence for `docs/sharing-state.md`'s "What happened".
- **The tests' own lessons**, for whoever writes the next ones: Docker's `--rm` removes a container in the
  background, and the next test on the same port found its name taken (the server tool removes it itself); a
  container's server has to listen on every interface; Playwright empties its output folder when it starts, so
  each part of a run has its own; a lookup refused for its rate needs the test to hold the page's own lookup until
  its forty are answered, or a token refilled meanwhile lets it through.

## What went differently from plan 3

- **The world trims after its snapshot, not before.** The plan had the host submit `{ trim: n }` first, and
  snapshot once it came back. An op sent first can find the log full, and then nothing can make room: the server
  asks a host for a snapshot once, and refuses ops while the log is full. So the host makes a snapshot that holds
  only the newest walls that fit, and once it is sent, which frees the log, submits `{ keep: n }`, which every page
  applies. Applied twice it is the same as once, and a newcomer who starts from the snapshot and applies the ops
  after it ends with the same walls as the pages that were there.
- **The largest world with 1 MB messages** also sets `P3P2_BYTES_RATE` to 1 MB, because of the second bug; a test
  with the byte rate as it comes is the one marked `test.fail()`.
- **Behind the proxy**, a test that restarts its server gets one of its own on this machine, as `restart.spec.ts`
  did before, and is not skipped.
- **The examples' own bugs**, found by their tests and fixed in the examples: the rally decided a flight while its
  connection was down, `room.send` said false, and the other page waited for that flight for ever (it now sends it
  again once back); the world counted where a player stood as written when the send had failed; the world said it
  was in a room before it had raised the room's world; the arena was taller than a phone on its side, and the thumb
  landed off the screen.
- `measure()` takes the server, and writes only with `E2E_RECORD=1`; `Traffic.game` is `Traffic.name`.
  `otherEngines()` fails where it used to leave an engine out. `examples/build.ts` packs the checkout's client for
  both `npm run examples` and the tests. `tools/run.ts` pulls the image for the image run; the setup pulls it only
  when it is missing.

## The shuffle by `sort`

As the plan asked, the world's Fisher–Yates shuffle was swapped once for `open.sort(() => draw(2) - 0.5)`, a sort
with a seeded comparison. The three-engine test failed at once: Chrome, Firefox and WebKit raised the same tiles
(they are drawn before the shuffle), but all 40 stones of the yard, the door and the way in came out in different
places in each, and both parts' fingerprints differed. The shuffle went back.

## Run times, on this machine

Measured on 2026-10-17, six cores and twelve threads, Chrome, Firefox and WebKit already installed. The last of
three runs of `npm run e2e:all`, the one after every fix:

| Run | Tests | Side by side | One at a time | Together | Plan 3's estimate |
|---|---|---|---|---|---|
| `npm run e2e` | 89 | 139 s (82) | 84 s (7) | 3.7 min | about 4 |
| `npm run e2e:measure` | 4 | | 57 s | 0.9 min | about 1 |
| `npm run e2e:clients` (0.1.0 and 0.1.1, one run) | 88: not `@this-client` | 139 s | 84 s | 3.7 min | about 5 |
| `npm run e2e:image` (0.1.1) | 89 and the upgrade | 160 s | 89 s | 4.2 min | about 6 |
| `npm run e2e:all` | | | | **12.5 min** | about 16, under 20 |

The games' last run took 31 minutes.

| `npm run e2e` here | Before (2026-10-17) | Plan 3's estimate | After |
|---|---|---|---|
| Tests | 29 | about 81 | 89 (94 with the measurements and the upgrade) |
| Test time, one after another | 122 s | about 8.5 min | 570 s, 9.5 min |
| Setup before the tests | a second or two | about 30 s on a first run, a few seconds once cached | 2.6 s with the builds made afresh, 2.0 s cached: Vite builds the three examples in well under a second |
| Tests 4 at a time | none | about 2.5 min | 139 s |
| Tests one at a time | all 29: 124 s | about 1.5 min | 84 s |
| **Total** | **2.1 min** | **about 4 min** | **3.7 min** |
| The 29 tests of before, on their own | 2.1 min | about 1 min | 70 s, with `host-ball`'s 36 s test as the floor |
| One example, `npm run e2e -- world` | | about 1 to 1.5 min | 65 s, 24 tests |

**CI**, estimated: CI's runner took 160 s where this machine took 124 for the same tests, and has four cores to
this machine's six. The main run's 3.7 minutes become about 5, and installing Firefox and WebKit with their system
libraries adds one or two: about 6 or 7 minutes for the `e2e` job, as the plan said. Your push will tell.

**Steadiness.** Two runs of `e2e:all`, the main run behind the proxy, and the four new specs twice more side by
side. The tests that failed now and then on the way had races of the test's own (a score read while the bots went
on catching, a bot's place checked against a bound that forgot how long a handover takes, a lookup that met a token
refilled meanwhile), or a bug of the example's own (below). After those fixes, the last runs failed nothing that was
not marked.

## What the examples cost the server

From `E2E_RECORD=1 npm run e2e:measure`, in `bench/results/examples/`, beside what the games of the same kind cost
(`p3p2-private/bench/results/games/`, by kind and not by name). A second, per player.

| | Players | Sent: frames, bytes | Got: frames, bytes | Database writes | The games of this kind |
|---|---|---|---|---|---|
| World: walking a step every 200 ms, one builder | 4 | 5.2, 441 | 7.1, 1,219 | 1.7 | walking one world: 10.5 to 12.6 frames, 1,000 to 1,432 bytes |
| Arena: everybody moving, the host reporting | 3 | 22.8, 1,637 | 26.6, 2,516 | 0.5 | one page runs it: 17 to 48 frames, 2,600 to 44,500 bytes |
| Duel: a probe every 1.5 s | 2 | 1.5, 75 | 1.8, 170 | 1.7 | in turns: 1.2 and 2.0 frames, 51 and 112 bytes |
| Rally: both paddles following the ball | 2 | 6.7, 441 | 6.7, 479 | 0.5 | on one clock: 1.6 and 18 frames, 73 and 1,005 bytes |

Nothing was dropped for the rate, and no volatile message for a receiver that was behind. The server's event loop
ran late by 1.2 ms at most. The examples are cheaper than the games where they move less: the world's walkers step
five times a second where the games' players walked all the time, and the rally's paddles move only as the ball
does. The arena's presence, 19 frames a second while moving, is the client's 20 a second, as in the games.

**The largest world** the example holds, from the tests' annotations:

| Messages | Walls | Kept | Snapshot: JSON, packed |
|---|---|---|---|
| 64 KB | scattered | 15,315 | 180,732 B, 61,835 B |
| 64 KB | in rows | 100,000, the example's own cap | 201,718 B, 19,031 B |
| 1 MB, and a byte rate of 1 MB a second | scattered | 100,000 | 711,255 B, 396,523 B |
| 1 MB, and a byte rate of 1 MB a second | in rows | 100,000 | 201,776 B, 19,167 B |

On a 16 KB log the world kept 1,613 of the 2,400 walls built, and every page, a newcomer's too, had the same.

**Smooth**, in the arena: a figure walking at 240 units a second, watched for three seconds at every animation
frame, is never drawn going back, and is 0.3 units from a straight line (rms), 1.0 through 150 ms each way and
50 ms of jitter.

## Still not reached

- **The new examples behind the proxy.** Caddy serves `examples/` as files, and three of the four have to be built;
  `E2E_PROXY=1` skips their specs. The image run covers the published server, but not over https.
- **The clients and image runs in CI**, by decision 6: a push that breaks an old client or the upgrade is found at
  the next `npm run e2e:all`, which is before a tag.
- **A real phone**, 3D, pictures and sound, as the plan says.
- **A game newer than its server** beyond what the player is told.
- **How long CI's `e2e` job takes now**, and how long installing Firefox and WebKit takes there: CI's first run of
  the new job is your push. If the install takes over a minute, a cache keyed by Playwright's version is the next
  step, as the plan says.

## The checks

| | |
|---|---|
| `npm run lint`, `npm run typecheck` | Clean |
| `npm test` | protocol 23, server 99, client 15, e2e's node tests 11, bench 10: all pass |
| `npm run build`, `npm run size` | Every budget kept; nothing in the client changed |
| `npm run test:pack` | 9 pass |
| `npm run e2e:all` | The third run: 265 pass, none fails, and the two `test.fail()` tests fail as marked in the main, clients and image runs. The two runs before found the races and the examples' bugs above |
| `E2E_PROXY=1 npm run e2e` | 29 pass, 60 skipped: the new examples' specs |

## Your commands

Nothing is committed. CI's first run of the new `e2e` job is your push.

```sh
git add .github .gitignore CONTRIBUTING.md README.md docs examples e2e package.json bench/results/examples
git commit -m "Example games, and browser tests that reach what real games need of p3p2"
git add ai/next_3.md
git commit -m "next 3: example games, and what they found"
```

## What comes next

- **The two bugs**, before the deferred fixes: the lost op touches every game that keeps something in the log.
- **The deferred security fixes**, each judged by `npm run e2e:all`: what later changes must keep is under test.
- **The VPS trial.**
