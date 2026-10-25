# Next 7: no ring on a click, the whole link on hover, the panel's words outside a room, the UI, the front page when a room is made

Plan 7 is carried out, with decisions 0 to 3 as recommended. Nothing is committed. The version is still 0.1.2: plan 7
goes out in 0.2.0, with plans 5 and 6, and changes neither the API nor the protocol.

## What changed

**Issue 1. The ring on a click.** A read-only field that was focused by a click or a tap draws no focus ring. Tab
still draws it, and a click still selects the whole link.

- How: the page remembers whether the last thing the visitor did was with a pointer or with the keyboard
  (`pointerdown` and `keydown`). When a read-only field takes focus, it gets `data-pointer` if it was the pointer,
  and `input[readonly][data-pointer]:focus-visible` draws no ring.
- Portal: `PORTAL_JS` and `PORTAL_CSS` (`server/src/http/assets.ts`). Panel: `panel.ts` and `style.ts`.

**Feature 1. The whole link on hover.** A link that doesn't fit ends in "…". While the pointer is over it, or Tab
has reached it, a bubble right under it shows the whole link, wrapped, light or dark. It's drawn over what is below,
lets clicks through, and is hidden from screen readers. A link that fits shows no bubble. Where: the room page, the
front page, and the panel.

**Feature 2. The panel outside a room.** The title is "Multiplayer – Powered by p3p2.me": "– Powered by" in the
panel's small grey text, and "p3p2.me" in bold italic serif (`"Iowan Old Style", "Palatino Linotype", Palatino,
P052, Georgia, serif`). Under it, your three lines, as sentences. p3p2.me in the third is the link, as before. The
*Join?* question keeps "Multiplayer".

**Feature 3. The UI**, all eight:

- 3a. On a phone (under 520 px), the link has a line of its own on the room page and the front page, and its
  buttons go under it.
- 3b. On a wide screen (640 px and over), the room page's QR code sits beside the invite's words and **Renew
  invite**: the invite card is about 340 px tall on a laptop, down from 480. Phones are as before.
- 3c. `h3` ("The game") is a step below the card's heading, with a line above it.
- 3d. "No rooms yet. Create one below, for the game you want to play." and "No room is open right now. Whoever runs
  this server can send you an invite link."
- 3e. Links and buttons are p3p2's teal: `#0b6e61` light, `#2cc7b1` dark, in the portal and the panel. Green
  (`--ok`) is only for "online" and "host". The panel's host tag is green now; it was the accent.
- 3f. The portal header's "p3p2" is set in the same italic serif as the panel's "p3p2.me".
- 3g. In the panel, the invite link has a line of its own, with **Copy**, **Share** and **QR code** under it.
- 3h. In the panel, **Leave** is on the line that names the server.

**Feature 4. The New room card:** Game URL; Room name and Most players; **On this server's front page** (Not shown
to start with); **Create room**. "Other sites that may use this room" is gone. The server reads `front` as Settings
does, makes the room with it, and no longer reads `origins`: a room starts with its game's own site, and more are
added in Settings. No migration: `rooms.front` is from migration 5.

**Feature 5.** In Settings, **On this server's front page** comes right after Room name and Most players.

**Docs:** `docs/host.md` ("Getting a room" has the front-page step; "Not shown" is the default, chosen when the
room is made or later) and `docs/integrate.md` (what the panel says without a link).

## Where it differs from the plan

- **Pointer or keyboard, for the whole page.** The plan set `data-pointer` on the field's own `pointerdown`. But a
  click on the panel's label text, or Copy without a Clipboard API, also focuses the field, and the attribute could
  outlive a click that never focused it. So the page remembers how the visitor last acted, and the field takes that
  when it gets focus.
- **The bubble's rule is two rules.** In one selector list with `:has()`, a browser without `:has()` (Firefox
  before 121) would drop the hover too.
- **The look tests have a file of their own,** `e2e/tests/look.spec.ts`: plan 6's two, moved from `chat.spec.ts`,
  and plan 7's five.
- **The portal's bubble test** uses a room for the examples' index page, whose link fits beside Play on the front
  page, and a 600 px window, where it doesn't fit beside Copy and Open. With the plan's chat link (69 characters),
  whether it fits on the front page came down to a few pixels.
- **The panel's colour test** compares the host tag with the p3p2.me link outside a room: in a room, nothing in the
  panel but the focus ring is in the accent.
- **Size:** the plan said about +0.3 KB for the panel; it is +0.45 KB. CSS comments ship in the panel's bundle, so
  the new ones are one line each.

## The checks

- `npm run lint`, `npm run typecheck`, `npm test` (server 112, protocol 23, client 16, e2e node 11, bench 10): clean.
- `npm run size`: entry 1.92 KB of 2; room client + panel 14.48 KB of 15 (was 14.03); one file 18.47 KB of 20 (was
  18.00); local room 1.72 KB of 1.8; smooth 1.38 KB of 1.5. The panel has 0.52 KB to spare.
- `npm run test:pack`: 9 of 9.
- The ring test fails without its CSS rule ("solid" where it expects "none"): I took the rule out for one run, and put
  it back.
- `npm run e2e`: 104 passed, 1 known bug (bug 1's test), 1 failed: "the chat opens with T, since Enter builds"
  (`world.spec.ts`), with Grace still counting 1 wall. That is the failure `ai/next_6.md` describes, in a test that
  uses nothing plan 7 changed. It then passed 15 times of 15 alone, and the whole world spec passed (26, and bug 1).
- `npm run e2e:all`, in 16.1 min:

  | Run | Passed | Known bugs | Failed |
  |---|---|---|---|
  | main | 105 | 1 | 0 |
  | measure | 4 | 0 | 0 |
  | clients 0.1.0, 0.1.1 | 95 | 1 | 0 |
  | client 0.1.2 | 95 | 1 | 0 |
  | image 0.1.2, with the upgrade | 95 | 1 | 1 |

  The image run's failure: "on a server whose log is small › the world keeps the newest walls that fit, …"
  (`world.spec.ts`). Grace's *Join?* never enabled. In the trace, her `GET /api/v1/invite` to the 0.1.2 server
  failed with no response at all, and `/api/v1/info` then answered, so the client took it for a site the room
  doesn't accept: "This room isn't set up for http://127.0.0.1:5181". Ada had joined from the same site a moment
  before. Neither that server nor the client's invite lookup changed in plan 7. The test then passed 8 times of 8
  against the image, and `npm run e2e:image` again had 96 passed, 1 known bug, none failed.

  The client's reading of a failed request is worth a look some day: a lookup that fails without an answer, from a
  site the room does accept, is reported as the room not accepting the site.

New e2e tests (6): in `look.spec.ts`, "in the portal, a click on an invite link draws no focus ring and Tab does, …"
(`@this-server`), "in the portal on a phone, an invite link has a line of its own, …" (`@this-server`), "in the
portal, a part of a card is a step below the card's heading, and links are p3p2's teal, …" (`@this-server`), "in the
panel, a click on the invite link draws no focus ring and Tab does, … Chrome, Firefox and WebKit" (`@this-client`),
and "in the panel, links are p3p2's teal and the host's tag the green of who is here, and Leave is on the line …"
(`@this-client`); in `chat.spec.ts`, "a room the owner puts on the front page as it is made is there at once"
(`@this-server`). "outside a room the panel …" checks the new title, its italic serif, and the three lines.

## Next

1. Read the diff, commit and push, and see CI green.
2. Release 0.2.0, with plans 5, 6 and 7: the steps are in `ai/plan_5.md`, "Releasing (yours)".
3. **First after the tag:** `@this-server` comes off the tests that have it (plans 5, 6 and 7's).
   `@this-client` stays while 0.1 clients are in the clients run.
4. **p3p2.me** still says a player "pastes a room URL into a game" (plan 7, "Yours, outside the repo").
5. **A lookup that fails without an answer** reads as "This room isn't set up for" the site (the image run, above).
   Once in one run so far.
6. Still waiting, from `ai/next_3.md` to `ai/next_6.md`: bug 1, the chat-key test that fails about once in ten
   runs, saved values that change during a gap, `crypto.subtle` on plain http, the packing figures, what the other
   player sees of a hit, the unread count for games with their own button, rally asking for the characters left
   out, a setting for the number of tries, an invite that doesn't run out, refusing room URLs from 0.1 games,
   lookalike names across scripts, and a library helper for things whose path can be worked out. And from plan 7:
   a drawn wordmark, and a players list on the room page that updates by itself.
