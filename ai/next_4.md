# Next 4: the bugs iteration 3 found, kept small

Plan 4 (take 2) is carried out, with decisions 1 to 3 as recommended. Bug 2 and bug 3 are fixed; bug 1 is
documented and set aside. Nothing in the protocol changed.

## What changed

**Bug 3 first, against today's code.** The new test "every op submitted while the connection is down arrives"
(`e2e/tests/world.spec.ts`) saw 118 of 256 ops arrive: the server took 120 frames at once, `hello` and the rest
among them, and dropped what followed. So bug 3 was real, and got the fix of decision 3.

- The test doesn't need the proxy's `hold()` the plan once had. The page builds its 256 walls inside its own
  `status` handler, in the same turn as `reconnecting`, so every op waits.

**Bug 3, the client** (`client/src/room.ts`):

- `sendWaiting()` sends at most `OPS_AT_ONCE` (60), then `OPS_PER_SECOND` (45) a second, from a timer. The timer is
  cleared in `dropped()` and `finish()`, and the next `welcome` starts again.
- A connected page with nothing waiting sends as before. Ops submitted while some wait go after them, in order, as
  before, and the cap of 256 stays.
- The test passes in about 10 s, with the tag `@this-client`.
- A doc comment in `room.ts` that had come to sit above `opsWaiting`, though it was `mine`'s, is back above `mine`.

**Bug 2, the server** (`server/src/config.ts`): `bytesBurst` is the larger of twice `P3P2_BYTES_RATE` and
`P3P2_MAX_FRAME_BYTES`. With the defaults it stays 512 KB.

- `server/test/config.test.ts` checks it with the defaults, with 1 MB frames, and with 1 MB frames and rate.
- "an op as large as a message may be arrives" lost its `test.fail()`, and has the tag `@this-server`.

**Bug 1, documented only.** "An op on its way to the server when the connection drops may be lost, and nothing says
so; one the server took always comes back through `apply`." Its test keeps `test.fail()`.

**Documents:**

- `docs/api.md`, the `log.submit` row: the pace after a gap, and bug 1's sentence.
- `client/src/types.ts`, `Log.submit`: the same, since a game's editor shows it from the `.d.ts`.
- `docs/sharing-state.md`, the log's bullets: the same, shorter.
- `README.md`: the `P3P2_MAX_FRAME_BYTES` row says what to keep it under before 0.1.2; the rate row gives the bursts.
- `docs/protocol.md`, the limits table: the byte burst, or one largest frame if that is more.

## The checks

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`: clean.
- `npm run size`: room client and panel 13.92 KB of 15 KB; the one-file build 17.77 KB of 20 KB.
- `npm run test:pack`: 9 of 9.
- `npm run e2e`: 89 passed, 1 known bug (bug 1's test), none failed, in 3.8 min.
- `npm run e2e:all`: every run green, in 12.7 min. Bug 1's test is the one known bug in each run.

  | Run | Passed | Known bugs | Failed |
  |---|---|---|---|
  | main | 89 | 1 | 0 |
  | measure | 4 | 0 | 0 |
  | clients 0.1.0, 0.1.1 | 87 | 1 | 0 |
  | image 0.1.1 | 89 | 1 | 0 |

One thing to know when running a single test by hand: the e2e setup takes the client from `client/dist`, so run
`npm run build` after changing `client/src/`. Without it the test meets the old client, as mine did at first.

## What to know about the pacing

- A game that submits more than 45 ops a second without pause, after a gap, adds them faster than they go. Its
  queue may fill to 256, and `submit` then says false. Before, such a game lost the ops past 120 once, without
  being told. None of the examples comes near it: the log is for changes to keep, and presence for what changes
  every frame.
- A server with `P3P2_MSG_RATE` below about 45 has a burst under 60, and may still refuse some ops after a gap.
  `docs/api.md` gives the pace, so a server's owner can work it out.

## Next

1. Commit and push, and see CI green.
2. Release 0.1.2 when you would release next: the steps are in `ai/plan_4.md`, "Releasing (yours)". Nothing here
   is urgent: bug 2 needs settings that aren't the defaults, and bug 3 needs a game that queues more than about 115
   ops while it is offline.
3. **First after the tag:** `@this-server` comes off "an op as large as a message may be arrives", since the
   published image then has the fix. `@this-client` stays on the bug 3 test: 0.1.0 and 0.1.1 send the waiting ops
   all at once.
4. Bug 1 stays aside until one of the triggers in `ai/plan_4.md`, "Bug 1, set aside": a player reports a lost move,
   a game where one lost op matters, or a measurement of how long a phone's browser keeps a dead connection open.
   The first plan 4 (`f383844`) has a design for it, and the risk its numbering carries.
5. Then `ai/prompt_5.md`, and what `ai/next_3.md` lists.
