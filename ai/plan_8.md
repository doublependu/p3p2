# Plan 8: the room list on a phone, "Powered by p3p2", a mark that shows the room is live, the unread badge

This answers `ai/prompt_8.md`. In short:

- **Issue 1. The room list on a phone.** The badges beside a room ("on the front page", "invite open", "0 online")
  keep their full width. The room's name and game get what's left: about 40 px on a 390 px phone, and a few letters
  a line. On a phone, the badges go on a line of their own, under the name and the game.
- **Feature 1.** The panel's title says "Multiplayer – Powered by **p3p2**", with p3p2 in bold and not in italic.
- **Feature 2. The mark on the multiplayer button.** It's gray while the player plays alone. In a room, it's p3p2's
  teal, and pulses while the connection to the server is live. When the server goes quiet, or the connection drops,
  the mark goes gray. It turns teal again when the server is heard from.
- **Feature 3. The unread badge** moves to the top-right corner of the button, which holds the mark and the player
  count. It no longer covers the start of the count.

Nothing here changes the API or the protocol. 0.2.0 isn't out yet (`package.json` says 0.1.2), so this goes out in
it, with plans 5, 6 and 7.

Answer the decisions first. Each one has a recommendation, and "Implement plan 8" without answers means the
recommendations.

## Decided

- **Decisions 0 to 3 as recommended** ("Implement plan 8 with the recommendations", 2026-10-26):
  - "p3p2" in the title in the same serif, bold and upright;
  - the portal header's "p3p2" drops the italic too;
  - a slow, soft pulse, 2 s a cycle, still under "reduce motion";
  - live means in a room, the connection open, and the server heard from in the last 12 s; otherwise gray and
    still.

## Decisions for you

**0. The face of "p3p2" in the title.** *Recommended:* the face it has now, bold and upright: `"Iowan Old Style",
"Palatino Linotype", Palatino, P052, Georgia, serif`, 700, 16 px. This only removes the italic, as you asked, and p3p2
still reads as a name beside the panel's sans-serif. I mocked it in the panel's CSS, in Chrome on this machine (P052,
Palatino's clone on Linux).

- Or: bold in the panel's own sans-serif. Then it reads as one more word of the title, since "Multiplayer" is in the
  same face and weight.

**1. The portal header's "p3p2".** Plan 7 (3f) set it in the panel's face, so that the server and the panel carry
one mark. *Recommended:* it drops the italic too.

- Or: the portal keeps the italic. Your prompt only names the panel.

**2. How the mark flashes.** *Recommended:* a slow, soft pulse. The teal fades to half and back, once every 2 s. It's
a fade, not a blink, so it doesn't pull the eye away from the game. It's also far under the three flashes a second
that can set off seizures. With the system's "reduce motion" on, the mark is teal and still.

- Or: one flash each time the server's heartbeat arrives, every 5 s, with the mark still between flashes. It's
  calmer, and each flash means the server just spoke. But it's less like the flashing you asked for.
- Not offered: a hard on/off blink. Over a game it would be the busiest thing on the screen.

**3. What counts as live, and what the mark shows when it isn't.** *Recommended:*

- **Live** means the player is in a room, the connection is open, and the server has been heard from in the last
  12 s. Every server, since 0.1.0, sends each room its round trips every 5 s (`docs/protocol.md`). It also answers
  the client's ping every 10 s. So 12 s means two missed beats, plus some slack.
- **Otherwise,** while reconnecting or while the server is quiet, the mark is **gray and still**, the same as alone.
  The number of players stays beside it, so the player can tell they're still in the room. When opened, the panel
  says "reconnecting…" as it does now. That's the two colours you asked for and no third one.
- Why the 12 s matters: a connection can die without the browser noticing, for example when a router drops it or
  the server's machine goes away. The browser only finds out when its own resends give up, and depending on the
  system that can take minutes. The server gives up on a silent player after 10 to 15 s, so after 12 s the mark is
  gray at about the moment the others see the player go.

Other ways:

- Amber while it isn't live: a third colour that says "trouble" rather than "alone".
- Live means only that the connection is open, with no 12 s check. That saves about 0.05 KB, but a connection that
  died silently would show as live until the browser gives up on it.

## Issue 1. The room list on a phone

### What I saw

I logged in to a server on this machine, made four rooms, and took screenshots of the dashboard at 1100, 390 and
320 px.

- At 390 px, "World with the cousins" took six lines and doublependu.github.io took four. "Friday night" broke as
  "Frid / ay / nigh / t".
- At 320 px, the name took one letter a line.
- At 1100 px, it's fine.

**Why:** `ul.list .grow` is `flex: 1`, so its starting width is zero. The badges keep their full width, about 275 px
for all three. The name and the game get what's left: about 40 px of the 324 that a 390 px phone has inside the
card. `overflow-wrap: anywhere` then breaks them wherever it has to.

The room page's **Players online** uses the same list, but there the badges are inside the name's span and wrap
with it. Only Kick is beside it, so that list is fine.

### The fix

- **Markup** (`dashboardPage`, `server/src/http/pages.ts`):
  - the list becomes `<ul class="list rooms">`;
  - a room's badges go in one `<span class="badges">`, so that they move as one.
- **CSS** (`PORTAL_CSS`, `server/src/http/assets.ts`):
  - `.badges { display: flex; flex-wrap: wrap; gap: 8px; }`, the gap they have now;
  - `.badge { white-space: nowrap; }`, so a badge never breaks inside;
  - under 520 px (the same width as plan 7's 3a), `.rooms > li` wraps and `.rooms .grow` takes the whole width, so the
    badges go under the game.
- `.rooms` is there so the players list keeps Kick beside the name on a phone.

I tried it on the page, with the CSS put in by hand. At 390 px, each room has three lines: the name, the game, and
the badges. "A very long room name for the weekend tournament" wraps at its spaces, in two lines. At 600 and 1100 px
it looks as it does now.

### Test

E2E, in the phone test in `look.spec.ts` ("in the portal on a phone, …", `@this-server`), a third check: on the
dashboard at 390 px, a room made onto the front page (so that it has all three badges) has:

- its name and game at least 90% of the row's width;
- its badges under the game;
- its name, "Phone room", on one line.

## Feature 1. Powered by p3p2 (decisions 0 and 1)

- `renderSetup` (`client/src/ui/panel.ts`): the title becomes "Multiplayer – Powered by p3p2". "– Powered by" stays
  in the panel's small grey text. The word is now "p3p2", without ".me".
- `.wordmark` in `client/src/ui/style.ts` loses `italic`.
- With decision 1: `.wordmark` in `PORTAL_CSS` loses `italic` too, and the two still match.
- p3p2.me is still the link in the third line, "No server yet? p3p2.me says how to get one.", in a new tab.

**Test:** "outside a room the panel …" (`chat.spec.ts`, `@this-client`) checks the title "Multiplayer – Powered by
p3p2", and that its face is 700 and `normal`, not italic. Its name changes to "outside a room the panel is powered by
p3p2, …".

## Feature 2. The mark: gray alone, teal and pulsing in a live room (decisions 2 and 3)

### Which buttons

- **The stand-in button** (`mount` in `client/src/index.ts`). It's on screen until the panel's code is needed, so
  during single-player play it's usually the one in view. Its `color:#fff` becomes the gray, and the mark is drawn
  in it.
- **The panel's button** (`.pill` in `panel.ts`), once the panel is loaded. It's gray outside a room, during *Join?*,
  and after leaving. It's teal and pulsing in a live room.
- A game with a button of its own (`ui: { button: false }`) shows neither, so nothing changes for it.
- A local room (`P3P2.local()`) doesn't touch the panel. That's single-player, so the mark stays gray.

### The colours

You asked for green in the brand colour. The brand colour is p3p2's teal, which plan 7 (3e) gave links and buttons.
The panel's green (`--ok`) means "online" and "host", so the mark uses the teal.

The pill is dark in both themes (`#1f201c` at 80%, over whatever the game draws), so the mark needs the light teal,
the one the panel uses in dark mode. Contrast with the pill, over four kinds of game:

| Over a game that is | Gray `#a3a094` | Teal `#2cc7b1` | Favicon teal `#0d7d6e` | White, as now |
|---|---|---|---|---|
| white | 3.3:1 | 4.0:1 | 1.7:1 | 8.5:1 |
| sky blue | 3.9:1 | 4.9:1 | 2.1:1 | 10.3:1 |
| mid grey | 4.9:1 | 6.0:1 | 2.5:1 | 12.7:1 |
| black | 6.7:1 | 8.3:1 | 3.5:1 | 17.5:1 |

- An icon needs 3:1. The gray (the panel's dark-mode soft colour) and the light teal pass over every kind of game.
  The favicon's teal and light mode's `#0b6e61` don't.
- At the pulse's faintest point, the teal is at half (1.9:1 over a white game), for a moment in each 2 s.
- The colours are written in as values, not as `var(--soft)` and `var(--accent)`. Those change with the theme, but
  the pill doesn't.

### How

- **`client/src/room.ts`:** `heardAt = Date.now()` on every frame from the server, in `ws.onmessage`. It's the
  counterpart of `saidAt`. It's internal, and not in the `Room` type.
- **`client/src/ui/panel.ts`:** a `drawMark()` that sets `live` on the pill when `room.status === 'open'` and
  `Date.now() - room.heardAt < 12_000`. It runs:
  - on each status change (from `drawMembers`, which already runs then);
  - every second while in a room. The interval is cleared with the room's other listeners, and `hide()` takes
    `live` off.
  - Setting the class to what it already is leaves the running animation alone, so the pulse doesn't restart each
    second.
- **`client/src/ui/style.ts`:**
  - `.mark { color: #a3a094; }` and `.live .mark { color: #2cc7b1; }`. The member count beside it stays white.
  - `.live .mark { animation: beat 2s ease-in-out infinite; }` and `@keyframes beat { 50% { opacity: .5 } }`.
  - `@media (prefers-reduced-motion: reduce)`: no animation.
  - Feature 3 takes the red unread badge out of `.mark`, so `.mark` holds only the mark and the badge doesn't fade
    with it.
  - It animates `opacity`, which browsers do without repainting, so it costs the game's frames nothing.
- **Not colour alone:** in a room, the count of players is beside the mark, and the panel says "reconnecting…". The
  button's name stays "Multiplayer", as the tests and screen readers know it.

I mocked it in the panel's CSS: the stand-in as now (white), gray alone, teal in a room with an unread badge, and
gray in a room. Each was over a white, a sky-blue and a near-black game, light and dark, and at the pulse's
faintest point. Gray and teal are easy to tell apart on all three.

### Tests

New, in `look.spec.ts`, all `@this-client`:

1. **"the mark is gray when playing alone, and teal and pulsing in a room"**:
   - the chat example without an invite: the stand-in's mark is gray;
   - the panel opened and closed again: the pill's mark is gray, with no animation;
   - in a room: teal, with the `beat` animation running;
   - after Leave: gray, and still;
   - in a context with `reducedMotion: 'reduce'`: teal in a room, and still.
2. **"the mark goes gray while the server can't be heard, and teal again when it can"**, through the lag proxy:
   - held and cut (`hold(true)`, then `drop()`): the client reconnects, the hello waits in the proxy, and the mark is
     gray at once;
   - let go: teal and pulsing again;
   - held alone: nothing arrives, the connection stays "open", and the mark goes gray within 13 s;
   - let go: teal again.
   - The test takes about 20 s.
   - `e2e/tools/lag-proxy.ts` gets `hold(on)`: while held, what comes in waits, in order, and isn't dropped.

### Docs

- **`docs/play.md`**, after "The window is behind the button with three players on it …": the three players are gray
  while you play alone, and teal, gently pulsing, while you're in a room and the connection to its server is live.
  Gray in a room, with the number of players still beside it, means the connection is down for now and the game is
  trying again.
- **`docs/integrate.md`**, "What the player gets": the same in one line. A game with its own button can show it too,
  from `room.status` and the `'status'` event (`docs/api.md`).

## Feature 3. The unread badge

### Now

The badge is inside `.mark`, at its top-right corner (`top: -8px; right: -9px`). The count is only 6 px to the right
of the mark, so the badge covers its start. In the panel's own CSS, measured in Chrome, the badge covers 3 × 8 px of
the count's box, and with "9+" it hides the top-left of a "3".

### The fix

- **`panel.ts`:** the badge moves out of `.mark` and becomes the pill's last child, after the count.
- **`style.ts`:**
  - `.pill` gets `position: relative`, and `.mark` loses it;
  - `.unread` goes to `top: -8px; right: -8px`, on the pill's top-right corner;
  - its size, colours and dark ring stay as they are.
- In a room the pill holds the mark and the count, so the badge sits at the top-right of both. Outside a room it's
  never shown: leaving a room sets it to 0.

I mocked three placements on the pill, with the counts "3" and "12" and the badges "2" and "9+", over a white and a
near-black game:

- **−8/−8** (chosen): the badge sits on the pill's rounded end and is clear of the count. Its bottom edge meets the
  top of the count's box, which is 3 px above the digits.
- −6/−6: a 1 × 2 px corner of "9+" touches the count's box.
- −7/−3: it overlaps the count's box by up to 4 × 1 px.

The badge reaches 7 px past the pill's top and right edges. The panel sits 12 px in from the corner of the screen,
so it stays on screen. In a bottom corner, it reaches up into the game, as any badge does.

### Test

The unread test, "chat that comes while the panel is closed is counted on the multiplayer button" (`chat.spec.ts`,
`@this-client`), checks the badge's position at "3" and at "9+":

- its box and the count's box don't overlap;
- its right edge is past the pill's right edge, and its top is above the pill's top.

No docs describe the badge, so none change.

## Size

| gzip | Now (`ai/next_7.md`) | Budget | Plan 8 |
|---|---|---|---|
| entry | 1.92 KB | 2 KB | about +0.005 KB: one colour |
| room client + panel | 14.48 KB | 15 KB | about +0.2 KB: the mark's CSS and pulse (0.12), the check each second (0.06), `heardAt` (0.02); the badge only moves |
| one file | 18.47 KB | 20 KB | about +0.2 KB |
| local room, smooth | 1.72, 1.38 KB | 1.8, 1.5 KB | nothing |

That leaves about 0.3 KB in the panel's budget. The portal has no budget. I'll give the numbers in `ai/next_8.md`,
and I won't raise a budget without asking you.

## The e2e runs

As in plans 5 to 7:

- `@this-server` for the portal's test (the room list);
- `@this-client` for the panel's (the title, the mark, the quiet server, and the badge).

When 0.2.0 is published, `@this-server` comes off them with the others.

## Order of the work

1. Issue 1: the list's markup and CSS, and the phone test.
2. Feature 1: the title, `.wordmark` in the panel and, with decision 1, in the portal, and the title test.
3. Feature 3: the badge out of `.mark` and onto the pill's corner, and its checks in the unread test. This comes
   first, since feature 2's pulse goes on `.mark`.
4. Feature 2:
   - `heardAt` in `room.ts`, `drawMark()` in the panel, and the CSS;
   - the stand-in's colour in `index.ts`;
   - `hold()` in the lag proxy;
   - the two tests.
5. The docs: `docs/play.md` and `docs/integrate.md`.
6. The checks:
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`;
   - `npm run test:pack`, `npm run e2e`, then `npm run e2e:all`.
7. `ai/next_8.md`, with screenshots of the dashboard on a phone, and of the mark and the badge in each state,
   described in words.

As always, I don't commit or push.

## Not in this plan

- **The client noticing a quiet server by itself.** With decision 3, the mark shows a quiet connection after 12 s,
  but the client doesn't act on it. It keeps waiting for the browser to give up, and only then reconnects. It could
  close the connection itself after the same 12 s and reconnect at once. That changes how the room client behaves
  for every game, so it should have a plan of its own.
- **A switch in the panel to stop the pulse.** The system's "reduce motion" setting stops it, and a game that wants
  none can use its own button.
- **Still waiting**, from `ai/next_7.md`:
  - a lookup that fails without an answer reads as "This room isn't set up for" the site;
  - p3p2.me still says a player "pastes a room URL into a game";
  - the list from `ai/next_3.md` to `ai/next_6.md`;
  - a drawn wordmark, and a players list on the room page that updates by itself.
