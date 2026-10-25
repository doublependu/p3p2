# Next 5: rooms on the server's front page, Smooth that only draws between, unread chat on the button

Plan 5 is carried out, with decisions 1, 3 and 5 as recommended and the logo's first tidy-up. Nothing is committed.
The version is still 0.1.2: 0.2.0 is yours to set when you release.

## What changed

**0. The logo** (`client/src/logo.ts`): the mark's `fill` and `opacity` are inline styles on each path, so a game's
`path { fill: … }` no longer paints the stand-in button. The comment naming p3p2.me is as it was: say if it should
go.

**1. Rooms on the front page.**

- **Server.**
  - Migration 5 adds `rooms.front`: NULL off the front page, otherwise how many characters the link there leaves
    out (0, 2, 3, 4 or 8). A 0.1 database comes out of it with every room off.
  - `/` for a visitor: the log-in page while no room is on the front page. Otherwise the front page: the rooms on it
    with an open invite, each with its link (dashes for the characters left out) and **Play**, or "No room is open
    right now". It is rate-limited per address like the room page, and never makes an invite.
  - Creating a room makes its invite.
  - The room page has an **Open** button beside Copy, which opens the link in a new tab. The invite card shows the
    characters left out. Settings has **On this server's front page**. Hiding more, or taking the room off, renews
    the invite; showing more keeps it.
  - The dashboard has the badge "on the front page", and a line under the list while any room has it.
  - Wrong tries: `Hub.lookUpInvite` is the one check, for `GET /api/v1/invite` and `hello`. It allows 10 per room,
    then one every 6 minutes, in memory. With none left: 429 `rate` from the look-up, and `rate` (closed) from
    `hello`. The log says `tried-out` once per room when it runs out.
  - A member resuming with its token is now looked at before the invite in `hello`. It is let in as before, and is
    never a try.
- **Protocol** (`links.ts`): `parseInvite` takes codes ending in dashes: 10 characters, at least 2 of them real.
  `INVITE_CODE_RE` is unchanged, so the server still takes whole codes only.
- **Client.**
  - `peek` and `join` reject a code with dashes with `hidden`.
  - The panel's *Join?* asks for "The last n characters". It reads them the way the alphabet does (capitals, o→0,
    i/l→1, no spaces), looks the invite up once they are all typed, and says "Those aren't the right characters."
    for a wrong set.
  - After joining, the player's panel has the whole link.
- **rally** has words for `hidden` (its list says it covers every code). It still doesn't ask for the characters,
  as the plan said.

**2. Smooth.** `coast` defaults to 0, with the header comment, `SmoothOptions.coast` and `docs/api.md` saying so. A
new test checks that nothing is drawn past the last report, whether reports stop or come late, and that with
`coast: 250` it does go past (so the test would notice).

**3. Unread chat.** The orange dot is now a red badge on the mark's corner: 1 to 9, then 9+. The button's name says
"Multiplayer, 3 unread messages". Opening the panel or leaving the room clears it.

**Docs**: `host.md` (Friends who come to the server, and **Open**), `play.md` (From the server's address, two new
rows), `self-host.md` (what the address shows; which refusals log an address), `security.md` (the characters left
out, and the limit), `protocol.md` (the dashed link, tries, `rate` from `hello`, the limit, a row in "Added within
protocol 1"), `api.md` (`p3p2.invite`, `hidden`, the three lines), and `README.md` (one sentence).

## Where it differs from the plan

- **The room page's link opens from an Open button**, not from the URL text itself. The e2e tests read the portal's
  link from its input (`toHaveValue`), and the image run runs them against the published 0.1.2. An input with the
  link stays, so they keep passing there.
- **Renewing the invite does not end a lock-out.** The tries left are the room's, not the invite's. After a renewal
  the room still has none, and a guesser, who reads the new link on the front page, uses each one up as it comes
  back. What works is showing the link whole, or taking the room off the front page: then nothing is a try.
  `host.md` and `security.md` say that, not "renew".
- **The panel cost more than "a few hundred bytes"**: room client + panel went from 14.17 to 14.79 KB of 15. That's
  the characters field and its look-up (about 0.4 KB) and the badge. I took a comment out of the panel's stylesheet
  (it ships as a string) and left the rest. There is 0.21 KB left for the next thing the panel needs.

## Decision 5: arena with `coast: 0`

"a figure moving at an even speed is drawn going steadily, never back", three runs each:

| | 0 ms: rms | 150 ms each way: rms | Smallest step forward |
|---|---|---|---|
| `coast: 250` (before) | 0.3, 0.4, 0.3 | 2.0, 1.2, 3.7 | 3.3 to 3.8 |
| `coast: 0` (now) | 0.3, 0.3, 0.3 | 3.5, 0.5, 2.0 | 3.4 to 3.8 |

The limits are 4 and 8. The two defaults are within each other's spread, and neither ever went back, so the
examples keep the new default with no change.

## The checks

- `npm run lint`, `npm run typecheck`, `npm test` (server 105, protocol 24, client 16, e2e node 11, bench 10):
  clean.
- `npm run size`: entry 1.95 KB of 2; room client + panel 14.79 KB of 15; one file 18.64 KB of 20; smooth 1.38 KB
  of 1.5.
- `npm run test:pack`: 9 of 9.
- `npm run e2e`: 93 passed, 1 known bug (bug 1's test), none failed, in 3.8 min.
- `npm run e2e:all`: every run green but one test in the main run, in 16.4 min. Bug 1's test is the one known bug
  in each run.

  | Run | Passed | Known bugs | Failed |
  |---|---|---|---|
  | main | 92 | 1 | 1 |
  | measure | 4 | 0 | 0 |
  | clients 0.1.0, 0.1.1 | 88 | 1 | 0 |
  | client 0.1.2 | 88 | 1 | 0 |
  | image 0.1.2 | 91 | 1 | 0 |

  **The one that failed**: "the chat opens with T, since Enter builds" (`world.spec.ts`). After the chat line, Ada's
  Enter should take the wall down, and Grace still counted 1 wall when the 5 s poll ran out. It passed in the
  earlier `npm run e2e`, in the image run (with this checkout's client), in both clients runs, 20 times out of 20
  alone, and 3 times out of 3 with the whole world spec, four at a time. I didn't find a cause. Nothing in plan 5
  touches the keys, the panel's chat key, or how ops go. The trace doesn't help: its screenshots are of the test
  before it ("In flight"). If it comes back, look there first.

The new e2e tests:

- `chat.spec.ts`:
  - "chat that comes while the panel is closed is counted on the multiplayer button" (`@this-client`)
  - "the owner's room page has an invite link before anyone has hosted, and it opens the game in a new tab"
    (`@this-server`)
  - "a friend who opens the server's address finds the room, types the characters its link leaves out, and plays
    with the host" (`@this-server`, `@this-client`)
  - "a game with its own Join? puts in the characters the link leaves out itself" (both tags)
- `upgrade.spec.ts`: after the upgrade, the setting reads "Not shown" and `/` goes to `/login`.
- `createRoom` logs in at `/login`.

## Next

1. Read the diff, commit and push, and see CI green.
2. Release 0.2.0: the steps are in `ai/plan_5.md`, "Releasing (yours)". `0.1` becomes `0.2` in the compose file
   and the three script tags.
3. **First after the tag:** `@this-server` comes off the three new tests that have it, once the published image has
   the front page. `@this-client` stays on the three that have it while 0.1 clients are in the clients run.
4. The p3p2.me comment in `logo.ts`: yours to say.
5. The panel's budget: the next feature there will need trimming, or a word from you about the budget.
6. Still waiting, from `ai/next_3.md` and `ai/next_4.md`: bug 1, saved values that change during a gap,
   `crypto.subtle` on plain http, the packing figures, and what the other player sees of a hit. And the plan's
   "Not in this plan": the unread count for games with their own button, rally asking for the characters, a
   setting for the number of tries.
