# Next 6: an even ball for guests, one player per browser, names, fields that look fixed, new tabs, one way in

Plan 6 is carried out, with decisions 0 to 5 as recommended, and p3p2.me in the panel, the README and the docs.
Nothing is committed. The version is still 0.1.2: 0.2.0, with plans 5 and 6, is yours to set when you release.

## What changed

**Issue 1. The ball on a guest** (`examples/host-ball/index.html` only; the library is unchanged).

- The host's report is `[x, y, vx, vy, at]`, with `at` from `room.now()`. A report also goes out at once when the
  ball turns off a brick or a kick turns it.
- A guest carries each report on by its age (at most 250 ms), and between reports moves the ball as the host does,
  bouncing it off the bricks still standing. Only the host submits anything.
- Every page draws the ball where it is at the frame's time. When a report came after the frame began, the ball is
  taken back to the frame's time.
- The ball now leaves a brick on the side it came in by, on every page. Before, it only turned, and a guest that
  bounced too would have turned again inside the brick.
- A live hit op no longer puts a guest's ball where it was at the hit. Only a page that is loading the log takes it.
- `game.drawn`, for the test. The game's version is 1.1.0, since the report changed.

Measured as in the plan: 4 s of frames on both pages, speed 4, through the lag proxy at 1 ms and up to 3 ms of
jitter. "Uneven" is a frame more than a quarter off the ball's speed, among the frames where it goes straight on.

| | Host: uneven | Guest: uneven | Guest from host, p95 (units) |
|---|---|---|---|
| Before (the plan's script: one run at speed 4, one at speed 1) | 8 of 200, 9 of 226 | 13 of 188, 21 of 202 | 10.9 (speed 4), 2.7 (speed 1) |
| After (14 runs of the script, then 12 of the test after the last fix below) | 0 in every run | 0 in every run | 0.4 to 2.5 |

What is left of the gap is the two pages' readings of the room's clock: `room.now()` is `Date.now()`, in whole
milliseconds, plus an offset each page finds by its pings. At speed 4 a millisecond is 0.7 units. It stays the same
from frame to frame, so it doesn't show.

**Issue 2. Two tabs** (`server/src/core/hub.ts`). A `hello` with the player id of a member already in the room
takes that member over, as a resume does. The older connection is told `bye replaced`, nobody else hears of it, it
gets in when the room is full, and its `mod` follows the new connection's way in. When the older page was still
open and the host, the role passes on, as at a reload.

**Feature 1. Fields that can't be changed.** A tinted background (`--fixed`) and no border, in the portal
(`input[readonly]`, `textarea[readonly]`) and in the panel (the invite link and the chat log). Fields that can be
changed are as they were.

**Feature 2. Names.**

- `cleanName` (`protocol/src/frames.ts`) keeps letters with their marks, digits, spaces and `. - _ '`, at most 24,
  and gives an empty name when no letter or digit is left. `nameKey` compares names after NFKC, in lower case.
- In `hello`, a new member whose name a member of the room has is refused with `name` (members in their grace period
  count). The same player taking its place over keeps its name. An empty name is `Player <id>`, or the next number
  nobody's name has.
- The client says "Somebody in this room already has that name. Choose another." The panel's *Join?* keeps the
  dialog open and puts the cursor in the name field. Leaving the field shows the name as it will be. rally has words
  for `name`.
- A 0.1 client is cleaned and refused the same way, and shows "Something went wrong (name)."

**Feature 3.** **Play** on the front page has `target="_blank" rel="noreferrer"`. **Open** already did.

**Feature 4. Everyone through the invite.**

- **Client:** `p3p2.host()`, `room.isMod`, `room.kick()`, `room.end()`, and the codes `room-url` and `room` are gone,
  with `checkRoom`, the saved room URL and the POST in `core.ts`. The panel outside a room says to open an invite
  link, and links to p3p2.me in a new tab. In a room it has no × and no **End for everyone**.
- **Portal:** no Room URL card; the invite card says everyone joins through it, the owner too; new words on the
  dashboard, on a visitor's page at a room's address, and in Rotate key's question. **Invite parameter** in the
  room's settings (migration 6, `rooms.param`), used by the links unless a 0.1 game that hosted said otherwise.
- **Kept for 0.1 games:** `hello` with a room key, `/api/v1/room` and `/api/v1/room/invite`, kick and end from a mod.
- **Examples:** rally's menu has no hosting part and no Remove or End; its words for `kicked` and `ended` name the
  room's owner. The examples that said "paste a room URL" say to open an invite link.
- **E2E helpers** (`e2e/tests/helpers.ts`): `createRoom` returns the room's `invite` (pressing **Create invite** on a
  0.1 server) and reads `roomUrl` from the page's address. `host(page, invite, name)` joins first and opens the
  panel at the link to pass on. New: `currentInvite` (logs in again after 30 days), `through` (an invite through a
  lag proxy), `kick` and `end` (in the portal).

**Docs:** the p3p2.me sentence in `README.md`, `client/README.md`, `docs/host.md`, `docs/integrate.md` and
`docs/self-host.md`; `host.md` rewritten around the invite link; `play.md` (names, tabs, Play, a row for `name`);
`integrate.md` ("What the player gets", "Try it", "Say when" in section 6, "From 0.1 to 0.2"); `sharing-state.md`
("Say when"); `testing.md`, `self-host.md`, `security.md`, `protocol.md` (two tabs, names, `name`, two rows in "Added
within protocol 1"); `api.md`.

## Where it differs from the plan

- **The host role on a duplicated tab.** The plan said a duplicated tab passes the role on too. The server can't
  tell a duplicated tab, which comes with the member's token, from a page coming back after a blip, which must keep
  the role. So only another tab without the token passes it on, and a duplicated tab is as before.
- **The test's measure** leaves out the frames where the ball turns, which are shorter by rights, and the gap limit
  is 5 units, not 1: what is left of it is the clock readings (above), up to 2.5 units in 26 runs.
- **The frame's time, taken back.** The first version failed the test 2 times in 12, with one-frame jumps forward on
  the guest: a report that came after a frame began put the ball past the frame's time. Taking it back to that time
  made it 0 in 12.
- **The world test "two people host an empty room at the same moment"** is now "two people join an empty room at
  the same moment". A page with an invite raises no world until the player answers *Join?*, so there are no two
  worlds before joining to compare; the test still checks that both end up in one.
- **rally's refusal test** opens an invite to a server that isn't there, and one to a plain-http server from an
  https page, in place of the room URLs it pasted.
- **`parseRoomUrl` and `roomUrl`** stay in `protocol/src/room-links.ts`, with their tests, though nothing uses them
  now. They describe what 0.1 clients send. Say if they should go.

## The checks

- `npm run lint`, `npm run typecheck`, `npm test` (server 111, protocol 25, client 16, e2e node 11, bench 10):
  clean.
- `npm run size`: entry 1.92 KB of 2 (was 1.95); room client + panel 14.03 KB of 15 (was 14.79), so the panel has
  0.97 KB to spare again; one file 18.00 KB of 20 (was 18.64); local room 1.72 KB of 1.8; smooth 1.38 KB of 1.5.
- `npm run test:pack`: 9 of 9.
- `npm run e2e`: 99 passed, 1 known bug (bug 1's test), none failed, in 3.8 min.
- `npm run e2e:all`: every run green, in 16.2 min. Bug 1's test is the one known bug in each run.

  | Run | Passed | Known bugs | Failed |
  |---|---|---|---|
  | main | 99 | 1 | 0 |
  | measure | 4 | 0 | 0 |
  | clients 0.1.0, 0.1.1 | 91 | 1 | 0 |
  | client 0.1.2 | 91 | 1 | 0 |
  | image 0.1.2, with the upgrade | 94 | 1 | 0 |

- After `e2e:all`, two changes that do nothing: `handOff` moved above `elect`'s doc comment, and the panel's unused
  `.status.ok` rule went. Lint, typecheck, `npm test`, size and the chat spec (26 of 26) ran again, clean.

New e2e tests: "the ball moves as evenly on a guest as on the host, over a network like a LAN" (`@alone`), and in
`chat.spec.ts` "outside a room the panel says to open an invite link, …" (`@this-client`), "two tabs of one browser
are one player …" (`@this-server`), "a player who picks a name already in the room …" (both), and the two look
tests (`@this-server`, `@this-client`).

## Next

1. Read the diff, commit and push, and see CI green.
2. Release 0.2.0, with plans 5 and 6: the steps are in `ai/plan_5.md`, "Releasing (yours)".
3. **First after the tag:** `@this-server` comes off the tests that have it (plan 5's three, and plan 6's: the room
   page without a room URL, two tabs, names, the portal's look). `@this-client` stays while 0.1 clients are in the
   clients run.
4. A dev server of yours that runs from this checkout gets migration 6 when it restarts. A 0.1 server refuses that
   database afterwards, as with migration 5.
5. Still waiting, from `ai/next_3.md` to `ai/next_5.md`: bug 1, saved values that change during a gap,
   `crypto.subtle` on plain http, the packing figures, what the other player sees of a hit, the unread count for
   games with their own button, rally asking for the characters left out, a setting for the number of tries. And
   plan 6's "Not in this plan": an invite that doesn't run out, refusing room URLs from 0.1 games, lookalike names
   across scripts, and a library helper for things whose path can be worked out.
