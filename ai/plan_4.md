# Plan 4: the two bugs iteration 3 found, and a third

This answers what you asked after iteration 3: whether the two bugs its tests found are on the server or the
client, and whether fixing them means a release right away. It fixes them in `protocol/`, `server/` and
`client/`, with their documents, and turns the tests that show them green.

Start once iteration 3 is pushed and CI is green on `main`, the new `e2e` job included. If that job fails on its
first run, its fix comes first, in this iteration.

Answer the decisions first. Each one has a recommendation, and "Implement plan 4" without answers means the
recommendations.

## In short

| Bug | Where | Who it hits | Fixed for a player when |
|---|---|---|---|
| 1. An op on its way to the server when the connection drops is lost | client, with a small server part | any game with a log, through a drop with an op in flight | the game's client and its server are both new |
| 2. A frame larger than twice `P3P2_BYTES_RATE` is always dropped as over the rate | server only | a server whose settings allow frames larger than its byte burst; never with the defaults | the server is new |
| 3. Ops that waited for the connection go all at once, and those past the server's burst are dropped | client, with a small server part | a game that submits more than about 115 ops while the connection is down | both are new |

Bug 3 I found reading the code for this plan, and no test shows it yet:

- the client takes up to 256 ops while the connection is down (`OPS_WAITING`), and `docs/api.md` promises they go
  when it is back;
- `sendWaiting()` sends them in one go;
- the server takes 120 frames at once from a member (`msgBurst`), and 512 KB (`bytesBurst`). Whatever comes faster
  is dropped with one `rate` error.

Step 1 writes its test first, against today's code. If that test passes, bug 3 leaves the plan.

## Releasing: no need to do it right away

- None of the three is a security problem or a regression: all have been there since 0.1.0.
- Bug 2 needs settings other than the defaults, and the settings themselves work around it: keep
  `P3P2_BYTES_RATE` at least half of `P3P2_MAX_FRAME_BYTES`. The README says so from step 2 on, with no release.
- Bugs 1 and 3 change nothing until both halves are out: the game's client and the server it uses. The sooner
  the release, the sooner players have the fix. That is a reason not to wait long, not a reason to hurry.

So release when you would release next. Decision 1 is its number.

## Decisions for you

1. **The version.** *Recommended:* 0.1.2, a patch.
   - Everything added is optional both ways within protocol 1, and no game has to change anything.
   - `@0.1` in the script tag and `^0.1.1` in a game's `package.json` pick the fix up by themselves. So does the
     compose file's `0.1` image tag at the next pull.

   Or 0.2.0. Games on `@0.1` would then stay without the fix until they change their tag.

2. **An op whose fate nobody knows.** A page may come back after its member's grace has run out (30 s by
   default). The server has then forgotten the member, and with it the number of the last op it took from it. An
   op the page sent just before the drop may be in the log, or may not.
   - *Recommended:* the client doesn't send it again. It tells the game with the room's `error` event, code
     `maybe-lost`, and the message says how many ops. The game can look at its state and decide.
   - Or the client sends it again. An op in the log twice ("take 5 coins", twice) is worse than one the game is
     told about.
   - Or the server keeps each member's last number past the grace. That is more server state for a rare case.

3. **Bug 3 in the same change.** *Recommended:* yes. Resending after a gap is bug 1's code too. Once the server
   sends each op back with its number, the client can hold ops back until the server has room for them:
   - `welcome.limits` also tells `msgBurst` and `bytesBurst`, as new optional fields;
   - the client keeps the ops it has sent and not yet seen back under half of each, and the next waits for one to
     come back;
   - one op may always go, so an op larger than half the byte burst still goes alone.

   While connected, this changes one thing. A burst of ops that would be dropped today as over the rate now waits
   its turn. The 256 cap on waiting ops stays, and `submit` says false past it, as now.

   Or not now: `docs/api.md` says that after a gap, ops past the server's burst may be dropped.

4. **Bug 2: raise the burst, or refuse such settings.** *Recommended:* raise it. The byte burst becomes the larger
   of twice the rate and `P3P2_MAX_FRAME_BYTES`.
   - A server should never refuse to start after an upgrade with the settings it started with before.
   - The rate over time stays as set. What the larger burst lets through at once is one frame, which the server
     already takes.

   Or the server refuses to start with such settings, and its message names both settings.

## The changes

### Bug 2 (server)

- `server/src/config.ts`: read `MAX_FRAME_BYTES` into a constant beside `bytesRate`, and set
  `bytesBurst: Math.max(bytesRate * 2, maxFrameBytes)`.
- `server/test/config.test.ts` checks the burst:
  - 512 KB with the defaults;
  - 1 MB with 1 MB frames;
  - 2 MB with 1 MB frames and a 1 MB rate.
- `README.md`, the `P3P2_BYTES_RATE` row: a player may send twice this at once, and at least
  `P3P2_MAX_FRAME_BYTES`; before 0.1.2, keep this at least half of `P3P2_MAX_FRAME_BYTES`.

### Bug 1 (protocol, server, client)

**Protocol.** Three additions within protocol 1, each optional both ways:

- The client's `op` gets `n`: the client's number for the op, from 1 for each member.
  - A server from before ignores it.
  - A malformed `n` is `bad-frame`, like the other fields of a client frame.
- The `op` the server sends to everyone carries the sender's `n`, when it gave one.
  - It goes in every copy, so the hub still builds one string.
  - Only the sender reads it; other clients ignore it.
- `welcome.lastOp`: the `n` of the last op from this member that the server has dealt with, taken or refused. It
  is 0 for a new member. Its presence is how the client knows the server takes `n`.

Where these go:

- `protocol/src/frames.ts`: `OpFrame.n`, `OpOutFrame.n` and `WelcomeFrame.lastOp`, in `parseClientFrame` and in the
  check of server frames;
- `protocol/test/frames.test.ts` and the fuzz test's frames;
- `docs/protocol.md`, "The log": the frames, a bullet on ops sent again, and "After a gap";
- the table "Added within protocol 1 since it was frozen", with one row dated the day.

**Server** (`server/src/core/hub.ts`):

- `Member` gets `lastOp`. It starts at 0 and lives as long as the member does, so a resume keeps it.
- `op()`: an op whose `n` is at or below `m.lastOp` is ignored, since the server already has it. Otherwise
  `m.lastOp = n`, whether the op is taken or refused because the log is full. So a refused op is not sent again.
- The echo carries `"n"`, and `welcome` carries `lastOp`.
- `server/test/hub.test.ts`:
  - the echo carries `n`;
  - the same `n` twice puts one op in the log;
  - a resume gets `lastOp` in `welcome`;
  - a refused op moves `lastOp` on;
  - a client that sends no `n` works as before, as a released client must.

**Client** (`client/src/room.ts`). With a server that sends `lastOp`:

- Each op gets the next number when it is sent, and the client keeps it until it comes back: an echo `from` itself
  with an `n` at or above that number. An op waiting for the connection gets its number when it goes.
- On each `welcome`, as the same member:
  - the client drops the kept ops at or below `lastOp`;
  - it sends the rest again with their numbers, in order, then the waiting ones;
  - the next number follows the larger of its own and `lastOp`.
- A page that has just loaded starts from `lastOp` the same way. That covers a reload, the door to another page of
  the same game, and a duplicated tab. Such a page must never reuse a number the server has seen, or the server
  ignores its ops.
- On a `welcome` as a new member, because the grace ran out: the kept ops go as decision 2 says, and numbers start
  again from `lastOp`, which is 0.
- With a server that sends no `lastOp`, the client keeps nothing, as today.
- `finish()` clears the kept ops with the waiting ones.

**`docs/api.md`:**

- In the `log.submit` row: an op on its way when the connection drops is sent again once it is back, with a
  server from 0.1.2 on.
- The `'error'` row gets `maybe-lost`.

### Bug 3 (decision 3)

- Server and protocol: `welcome.limits.msgBurst` and `bytesBurst`, in `protocol.md`'s `welcome` and in the same
  table row.
- Client: the ops it has sent and not seen back stay under half of each burst, and one op may always go. With a
  server that tells neither, it sends as today.
- `docs/api.md`'s `log.submit` row keeps its promise, which is now true.

### The tests

Two existing tests in `e2e/tests/world.spec.ts` turn green:

- "an op on its way to the server when the connection drops is not lost": `test.fail()` comes off, and it gets
  the tags `@this-client` and `@this-server`.
- "an op as large as a message may be arrives": `test.fail()` comes off, and it gets the tag `@this-server`.

New in `world.spec.ts`:

- **"every op submitted while the connection is down arrives"** (bug 3). The test submits 256 small ops while the
  connection is held down. Once it is back, another page must have all 256.
  - It is written in step 1, against today's code, with `test.fail()` if it fails.
  - When bug 3 is fixed, it gets the tags `@this-client` and `@this-server`.
- **"an op sent as the connection dropped, back after the grace: the game is told it may be lost"** (decision 2).
  It runs with `P3P2_GRACE_SECONDS` at 2, and the connection is held down for 4 s.
- **The numbering after a reload.** The door test already sends an op after its page changes. If it doesn't cover
  a reload, it gets one, with an op after it.

Holding the connection down needs a `hold(ms)` on `e2e/tools/lag-proxy.ts`, which today can only `drop()`. It
refuses new connections for that long.

**The runs before the release.** Each tag leaves the tests out of the run whose half isn't fixed yet, so every run
stays green:

| Run | What it tests | Tests with the tag left out |
|---|---|---|
| main | this checkout's client and server | none: all pass |
| clients | each released client against this server | `@this-client` (0.1.0 and 0.1.1 send no `n`) |
| image | this checkout's client against the published 0.1.1 server | `@this-server` (the server sends no `lastOp`, and has the small burst) |

So the fixes can wait on `main` for as long as you like.

## Order of the work

1. Bug 3's test, with `hold()`, against today's code. If it passes, bug 3 and decision 3 leave the plan.
2. Bug 2: the config, its test, the README row, and its e2e test turned green.
3. Protocol: frames, parsing, tests, `docs/protocol.md`.
4. Server: `lastOp`, `n`, the echo, `welcome` (`lastOp`, and the bursts with decision 3), and the hub's tests.
5. Client: numbering, keeping, sending again, holding back, `maybe-lost`; `docs/api.md`.
6. The e2e tests: the bug 1 test turned green, the grace test, and the reload.
7. The checks:
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`;
   - `npm run size`: the client grows a little, and must stay within its budget;
   - `npm run test:pack`, `npm run e2e`, then `npm run e2e:all`.
8. `ai/next_4.md`.

As always, I don't commit or push.

## Releasing (yours)

As `CONTRIBUTING.md` says, with 0.1.2 (decision 1):

- `npm version 0.1.2 --workspaces --include-workspace-root --no-git-tag-version`;
- commit and push;
- once CI is green, `npm run build && npm run e2e:all`, then tag.

A patch changes no `X.Y` in the compose file or the script tags. Before the tag, `e2e:all` still meets the
published 0.1.1 image, and the tags above keep it green.

## After the release

- `@this-server` comes off the three tests, since the published image then has the fixes.
- `@this-client` stays: 0.1.0 and 0.1.1 never resend an op.

`ai/next_4.md` names this as the first thing to do after the tag.

## Not in this plan

- **A saved value on its way when the connection drops is lost the same way.** `room.send` says false while the
  connection is down, so a game can send such a value again, but not one that was already on its way. Numbering
  messages with `retain` the way this plan numbers ops would cover it. It is the next candidate, and needs its
  own look at what the server keeps.
- The improvements and documents in `ai/next_3.md`:
  - saved values that change during a gap;
  - `crypto.subtle` on plain http;
  - the packing figures;
  - what the other player sees of a hit.
