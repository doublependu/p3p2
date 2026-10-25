# Next 8: the room list on a phone, "Powered by p3p2", a mark that shows the room is live, the unread badge

Plan 8 is carried out, with decisions 0 to 3 as recommended. Nothing is committed. The version is still 0.1.2: plan 8
goes out in 0.2.0, with plans 5, 6 and 7, and changes neither the API nor the protocol.

## What changed

**Issue 1. The room list on a phone.** A room's badges are in one group (`<span class="badges">`), and the list is
`<ul class="list rooms">`. Under 520 px, the room's name and game take the whole width, and the badges go on the line
under them. A badge never breaks inside (`white-space: nowrap`). At 600 px and over, the list looks as before. The
room page's Players online keeps Kick beside the name.

**Feature 1.** The panel's title is "Multiplayer – Powered by p3p2". "p3p2" is in the same serif as before, bold and
upright. The portal header's "p3p2" is upright too, so the two still match. p3p2.me is still the link in the panel's
third line.

**Feature 2. The mark.**

- **Gray** (`#a3a094`) while the player is alone: on the button that stands in for the panel, and on the panel's own
  button outside a room, during *Join?*, and after leaving.
- **Teal** (`#2cc7b1`), fading to half and back every 2 s, while the player is in a room, the connection is open, and
  the server was heard from in the last 12 s. With "reduce motion" on, it's teal and still.
- **Gray again** while reconnecting, or when the server has been quiet for 12 s. The player count stays beside it.
- How:
  - `RoomClient.heardAt` is set on every frame from the server. It isn't in the `Room` type.
  - The panel's `drawMark()` runs on every status change and once a second while in a room. It sets `live` on the
    button.
  - The pulse animates the opacity of `.mark`. The badge is no longer inside `.mark`, so it doesn't fade.

**Feature 3. The unread badge** is the panel button's last child, on its top-right corner (`top: -8px; right:
-8px` from the button, which is now `position: relative`). It no longer covers the count. Measured in Chrome with
"9+" and a count of 2: the badge starts 1 px right of where the count ends, and its bottom edge meets the top of the
count's box.
It reaches 7 px past the button's top and right edges.

**Docs:**

- `docs/play.md`: what the gray and the teal mean, for players.
- `docs/integrate.md`, "What the player gets": the same in a line. A game with its own button can show roughly the
  same from `room.status`.

## Where it differs from the plan

- **Size:** the plan said about +0.2 KB for the panel; it's +0.28 KB, 14.76 KB of 15. As in plan 7, the CSS comments
  ship in the bundle. The panel has 0.24 KB to spare.
- **Reduce motion is tested on the same page** (`page.emulateMedia`), not in a context of its own, and the pulse is
  checked to come back afterwards.
- **The quiet-server test is skipped under `E2E_PROXY=1`**, as duel's lag-proxy test is: the proxy forwards to the
  server's port on this machine, and that setup puts the server behind Caddy. It takes about 16 s, not 20.
- **`hold()` holds new connections too.** That's what keeps the client from reconnecting in the test's first half,
  as the plan describes. Let go, every connection's waiting data goes out, in order.

## The checks

- `npm run lint`, `npm run typecheck`, `npm test` (server 112, protocol 23, client 16, e2e node 11, bench 10): clean.
- `npm run size`: entry 1.92 KB of 2 (unchanged at two decimals); room client + panel 14.76 KB of 15 (was 14.48);
  one file 18.72 KB of 20 (was 18.47); local room 1.72 KB of 1.8; smooth 1.38 KB of 1.5.
- `npm run test:pack`: 9 of 9.
- **The new tests fail without their fixes.** I ran each against the old code for one run, then put the fix back:
  - Without the 12 s check, the quiet-server test fails: the mark stays teal and pulsing while the server is
    held quiet.
  - With the badge back inside the mark, the unread test fails: the badge overlaps the count.
  - Without the phone rule, the phone test fails: the room's name and game get 39.5 px of 324.
- `npm run e2e`: 107 passed, 1 known bug (bug 1's test), none failed.
- `npm run e2e:all`, in 16.5 min, with nothing failed in any run:

  | Run | Passed | Known bugs | Failed |
  |---|---|---|---|
  | main | 107 | 1 | 0 |
  | measure | 4 | 0 | 0 |
  | clients 0.1.0, 0.1.1 | 95 | 1 | 0 |
  | client 0.1.2 | 95 | 1 | 0 |
  | image 0.1.2, with the upgrade | 98 | 1 | 0 |

  The known bug is bug 1's test in every run. The image run's failure in `ai/next_7.md` (a lookup that failed
  without an answer) didn't come back this time.

New e2e tests (2), in `look.spec.ts`, both `@this-client`:

- "the multiplayer button's mark is gray while the player is alone, and teal and pulsing in a room";
- "the multiplayer button's mark goes gray while the server can't be heard, and teal again when it can".

Changed:

- the phone test in `look.spec.ts` ("… and a room in the list its badges under its name", `@this-server`);
- the unread test in `chat.spec.ts` (the badge's corner, at "3" and "9+");
- the title test, "outside a room the panel is powered by p3p2, …".

## What it looks like

I ran the checkout's server and the examples and took screenshots:

- **The dashboard at 390 and 320 px, light and dark:** each room has three lines: its name, its game, and its
  badges. "A very long room name for the weekend tournament" wraps at its spaces, in two lines.
- **The panel's title:** "Multiplayer" in bold sans, "– Powered by" small and grey, "p3p2" in a bold upright serif.
- **The portal header:** the mark, then "p3p2" in the same upright serif.
- **The button:**
  - alone, as the stand-in and as the panel's button: the gray mark on the dark button;
  - in a room of two: the teal mark and "2", at full strength and at the pulse's faintest;
  - with "3" and "9+" unread: the red badge sits on the button's rounded right end, above and to the right of
    the "2", with nothing covered.

## Next

1. Read the diff, commit and push, and see CI green.
2. Release 0.2.0, with plans 5 to 8: the steps are in `ai/plan_5.md`, "Releasing (yours)".
3. **First after the tag:** `@this-server` comes off the tests that have it (plans 5 to 8's). `@this-client` stays
   while 0.1 clients are in the clients run.
4. **The client noticing a quiet server by itself** (plan 8, "Not in this plan"). The mark now shows a quiet
   connection after 12 s, but the client goes on waiting for the browser to give up before it reconnects. Closing
   and reconnecting after the same 12 s would get a player back sooner. That's a plan of its own.
5. **p3p2.me** still says a player "pastes a room URL into a game" (plan 7).
6. **A lookup that fails without an answer** reads as "This room isn't set up for" the site (`ai/next_7.md`).
7. Still waiting, from `ai/next_3.md` to `ai/next_7.md`: bug 1, the chat-key test that fails about once in ten
   runs, saved values that change during a gap, `crypto.subtle` on plain http, the packing figures, what the other
   player sees of a hit, the unread count for games with their own button, rally asking for the characters left
   out, a setting for the number of tries, an invite that doesn't run out, refusing room URLs from 0.1 games,
   lookalike names across scripts, a library helper for things whose path can be worked out, a drawn wordmark, and
   a players list on the room page that updates by itself.
