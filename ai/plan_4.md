# Plan 4: the bugs iteration 3 found, kept small

This answers what you asked after iteration 3: whether the bugs its tests found are real, and worth fixing. They
are real, but each needs an unusual situation. Eight games on 0.1.1, played on phones against a VPS, have met none
of them. So this plan does only the cheap, safe part:

- **Bug 2:** fixed. One line in the server. Nothing changes with the default settings.
- **Bug 3:** first a test against today's code. If the test passes, nothing more. If it fails, you decide between
  a small client-only fix and a sentence in the docs (decision 3).
- **Bug 1:** not fixed. `docs/api.md` says what can happen, and its test stays as the record.

The first version of this plan fixed all three, with a protocol change for bug 1. It is in git, at `f383844`, for
when bug 1 comes back (see "Bug 1, set aside").

Start with CI green on `main`. Answer the decisions first. Each one has a recommendation, and "Implement plan 4"
without answers means the recommendations.

## Decided

- 2026-10-23: keep plan 4 small. Fix bug 2, test bug 3 before doing anything about it, and set bug 1 aside with
  a sentence in `docs/api.md`. The reason: none of the three has shown up in real games, and bug 1's fix is most
  of the work and most of the risk.
- 2026-10-23: decisions 1 to 3 as recommended: 0.1.2; bug 2 raises the burst; if bug 3's test fails, the client
  paces the ops that waited.
- 2026-10-23: bug 3 is real. Its test, against today's code, saw 118 of the 256 ops arrive.

## The three bugs

| Bug | Where | When it happens | Here |
|---|---|---|---|
| 1. An op on its way to the server when the connection drops is lost, and nothing tells the game | client | a game that uses `log.submit`, and an op sent just as the network goes | documented, not fixed |
| 2. A frame larger than twice `P3P2_BYTES_RATE` is always dropped as over the rate | server | only with `P3P2_MAX_FRAME_BYTES` raised above 512 KB; never with the defaults | fixed |
| 3. Ops that waited for the connection go all at once, and those past the server's burst are dropped | client | a game that submits more than about 115 ops while the connection is down | tested first |

None is a security problem or a regression: all have been there since 0.1.0.

## Decisions for you

1. **The version.** *Recommended:* 0.1.2, a patch, when you would release next anyway. Nothing here needs a
   release soon: bug 2 has a workaround in the settings, which the README gives from step 2 on.

2. **Bug 2: raise the burst, or refuse such settings.** *Recommended:* raise it. The byte burst becomes the larger
   of twice the rate and `P3P2_MAX_FRAME_BYTES`.
   - With the defaults the burst stays 512 KB, so nothing changes for a server that doesn't set these.
   - A server should never refuse to start after an upgrade with the settings it started with before.
   - The rate over time stays as set. What the larger burst lets through at once is one frame, which the server
     already takes.

   Or the server refuses to start with such settings, and its message names both settings.

3. **Bug 3, if its test fails.** Step 1 tells which case applies.
   - *Recommended:* the client paces the ops that waited. `sendWaiting()` sends at most 60 at once, then 45 a
     second until none wait.
     - That is half the default server's burst (120 frames) and rate (90 a second), which leaves room for
       presence (up to 20 a second), pings and the rest.
     - Only the way back from a gap changes. A connected page with nothing waiting sends as today.
     - Ops submitted while some still wait go behind them, in order, as today.
     - It is client-only: no protocol change, and it works with every server, 0.1.0 and 0.1.1 included.
     - A server with `P3P2_MSG_RATE` below 45 may still refuse some. `docs/api.md` gives the pace, so that can be
       worked out.
   - Or only the docs: `docs/api.md` says that after a gap the waiting ops go at once, and that those past what
     the server takes at once (120 with its defaults) are refused with `rate`. The test stays with `test.fail()`.

   If the test passes, bug 3 isn't real. The test stays, as a guard, and nothing else changes.

## The changes

### Bug 2 (server)

- `server/src/config.ts`: read `MAX_FRAME_BYTES` into a constant beside `bytesRate`, and set
  `bytesBurst: Math.max(bytesRate * 2, maxFrameBytes)`.
- `server/test/config.test.ts` checks the burst:
  - 512 KB with the defaults;
  - 1 MB with 1 MB frames;
  - 2 MB with 1 MB frames and a 1 MB rate.
- `README.md`, the settings table:
  - the `P3P2_MAX_FRAME_BYTES` row: before 0.1.2, keep it at most twice `P3P2_BYTES_RATE`, or messages that large
    are always refused;
  - the `P3P2_MSG_RATE`, `P3P2_BYTES_RATE` row: a player may send twice the byte rate at once, and at least one
    largest message.
- `e2e/tests/world.spec.ts`, "an op as large as a message may be arrives": `test.fail()` comes off, and it gets
  the tag `@this-server`.

### Bug 3 (test first)

New in `e2e/tests/world.spec.ts`: **"every op submitted while the connection is down arrives"**.

- Two players in a room through the lag proxy. The proxy drops, and the test waits for `reconnecting`.
- In one `page.evaluate`, the page checks that the room still says `reconnecting`, then builds 256 walls with one
  op each. Since that is one turn of the page's code, all 256 wait, and the proxy needs no new `hold()`.
- Once the room is open again, the other page must count 256 walls.

Then, by what step 1 shows and decision 3:

- **The test passes:** it stays as it is.
- **It fails, and the client paces (recommended):**
  - `client/src/room.ts`: `sendWaiting()` sends at most 60, then sets a timer for the next 45 a second later, and
    so on. `dropped()` and `finish()` clear the timer, and the next `welcome` starts again.
  - `docs/api.md`, the `log.submit` row: after a gap, the ops that waited go at most 60 at once, then 45 a second.
  - The test turns green, with the tag `@this-client`: the released clients send everything at once.
- **It fails, and only the docs change:** the sentence of decision 3 in the `log.submit` row, and the test keeps
  `test.fail()` with that reason.

### Bug 1 (docs only)

`docs/api.md`, the `log.submit` row gets one sentence: an op on its way to the server when the connection drops may
be lost, and nothing says so. An op that was taken always comes back through `apply`.

The test "an op on its way to the server when the connection drops is not lost" keeps its `test.fail()`, as the
record of the bug.

## Bug 1, set aside

Come back to it when:

- a player reports a move that didn't happen;
- or before a game where one lost op really matters, such as trades or coins;
- or after a measurement of how long a phone's browser goes on believing a dead connection is open. The client has
  no timeout of its own: it waits for the browser to report the close (`dropped()` in `client/src/room.ts`). Every
  op sent in that time is lost, not just one in flight. I haven't measured how long that is.

What is known for then:

- The fix in `f383844` numbers each op. The server keeps the last number of each member and sends it in
  `welcome`, and the client keeps the ops it sent and sends again the ones the server hasn't had.
- Its risk is the numbering. A page that gets its numbers wrong, after a reload, through the door or in a
  duplicated tab, has **every** op ignored by the server. That is far worse than today's bug, so the design
  needs its own careful look and tests for each of those cases.
- A page back after the grace period (30 s by default) can't know whether its op was taken. That plan's answer was
  to tell the game with a new `error` code, `maybe-lost`. Games that take every `error` as fatal would need to
  know about it.
- A saved value (`room.send` with `retain`) on its way when the connection drops is lost the same way, and would
  take the same kind of fix.

## The runs before the release

Each tag leaves a test out of the run whose half isn't fixed yet, so every run stays green:

| Run | What it tests | Tests with the tag left out |
|---|---|---|
| main | this checkout's client and server | none: all pass |
| clients | each released client against this server | `@this-client` (bug 3's test, if the client paces) |
| image | this checkout's client against the published 0.1.1 server | `@this-server` (bug 2's test) |

## Order of the work

1. Bug 3's test, against today's code. Its result decides what decision 3 is about.
2. Bug 2: the config, its test, the README rows, and its e2e test turned green.
3. Bug 3, by decision 3.
4. Bug 1's sentence in `docs/api.md`.
5. The checks:
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`;
   - `npm run size`, if the client changed;
   - `npm run test:pack`, `npm run e2e`, then `npm run e2e:all`.
6. `ai/next_4.md`.

As always, I don't commit or push.

## Releasing (yours)

As `CONTRIBUTING.md` says, with 0.1.2 (decision 1):

- `npm version 0.1.2 --workspaces --include-workspace-root --no-git-tag-version`;
- commit and push;
- once CI is green, `npm run build && npm run e2e:all`, then tag.

A patch changes no `X.Y` in the compose file or the script tags. Before the tag, `e2e:all` still meets the
published 0.1.1 image, and the tags above keep it green.

After the release:

- `@this-server` comes off bug 2's test, since the published image then has the fix.
- `@this-client` stays on bug 3's test: 0.1.0 and 0.1.1 send the waiting ops all at once.

`ai/next_4.md` names this as the first thing to do after the tag.

## Not in this plan

- Bug 1's fix, and the same fix for saved values: see "Bug 1, set aside".
- The improvements and documents in `ai/next_3.md`:
  - saved values that change during a gap;
  - `crypto.subtle` on plain http;
  - the packing figures;
  - what the other player sees of a hit.
