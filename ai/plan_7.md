# Plan 7: no ring on a click, the whole link on hover, the panel's words outside a room, a look at the UI, the front page when a room is made

This answers `ai/prompt_7.md`. In short:

- **Issue 1. The ring on a click.** All three browser engines count a mouse click on a read-only text field as
  keyboard focus (`:focus-visible`), so our focus ring is drawn. The chat log takes no focus on a click, which is why
  it has no ring. The fix: a read-only field that the pointer focused draws no ring. Tab still draws it.
- **Feature 1. The whole link on hover.** A link that doesn't fit ends in "…", and the pointer over it shows the
  whole link in a bubble under the field, at once.
- **Feature 2. The panel outside a room** says "Multiplayer – Powered by **p3p2.me**" and your three lines.
- **Feature 3. The UI.** I looked at every page of the portal and the panel, light and dark, on a laptop and on a
  phone. Eight changes are listed below for you to pick from (decision 3).
- **Feature 4. The New room card** loses "Other sites that may use this room", and gets the front-page choice.
- **Feature 5. Settings:** **On this server's front page** moves up, under Room name and Most players.

Nothing here changes the API or the protocol. 0.2.0 isn't out yet (`package.json` says 0.1.2), so this goes out in
it, with plans 5 and 6.

Answer the decisions first. Each one has a recommendation, and "Implement plan 7" without answers means the
recommendations.

## Decided

Nothing yet.

## Decisions for you

**0. How hovering shows the link.** *Recommended:* a bubble under the field, shown at once, only when the link
doesn't fit. It's drawn in the page's own style, light or dark, and it also shows when Tab reaches the field. About
0.15 KB in the panel.

- Or: the field's `title`. That's the browser's own tooltip. It costs nothing, but it comes after about a second,
  in the system's style, and also when the whole link is already in view.

**1. The "fancy font" for p3p2.me.** The panel runs inside other people's games, so it can't load a font: their CSP
may forbid it, and a font file is bigger than the whole panel. So the choice is among the fonts every system has. I
mocked four versions of the title in the panel's own CSS, in Chrome on this machine.

*Recommended:* **bold italic serif**: `"Iowan Old Style", "Palatino Linotype", Palatino, P052, Georgia, serif`, at
16 px. That's Palatino on Windows and macOS, and its clone (P052) on Linux. Next to the panel's sans-serif it reads
as a signature, and it looks much the same on every system.

- Or: **bold monospace** (`ui-monospace, …`). It looks like a domain name, but code-like.
- Or: **heavy, tight sans** (800, −0.04 em). It's the quietest of the three, and not much like a fancy font.
- Not offered: `cursive`, which is Comic Sans on Windows; and `ui-rounded`, which only Safari has, so it falls back
  to plain sans everywhere else.
- Later, if you want one: a drawn wordmark (an SVG) would look exactly the same everywhere, and p3p2.me could use
  it too. It's a brand asset, so I'd rather you drew it or chose it.

**2. The front page on the New room card.** *Recommended:* the same choice as in the room's Settings: **On this
server's front page**, with **Not shown**, **Shown, with the whole invite link**, and **Shown, without the link's
last 2, 3, 4 or 8 characters**. It starts at Not shown. The same words and choices in both places, and the owner
decides how much of the link is public when making the room.

- Or: a checkbox, **Publish the invite link on this server's front page**. Ticked, the room is shown with its whole
  link. Hiding characters is then done in Settings.

**3. Which UI changes** (feature 3, below). *Recommended:* all eight. Each one stands alone, so any of them can be
left out.

## Issue 1. The ring on a click

### What I measured

A page with a read-only field, a field you can type in, a scrolling list like the chat log, and a button. Each was
clicked with the mouse, and then the script asked whether it matched `:focus-visible`.

| | Read-only field | Field you type in | Scrolling list | Button |
|---|---|---|---|---|
| Chrome 156 | focused, focus-visible | focused, focus-visible | not focused | focused, not focus-visible |
| Firefox 157 | focused, focus-visible | focused, focus-visible | not focused | focused, not focus-visible |
| WebKit 27.2 | focused, focus-visible | focused, focus-visible | not focused | focused, not focus-visible |

Browsers always show focus on a text field, since it takes typing, and they don't make an exception for read-only
ones. Our rule `input:focus-visible { outline: 2px solid var(--accent) }` then draws the green ring: in the portal
(`server/src/http/assets.ts`) and in the panel (`client/src/ui/style.ts`). The screenshots show it on the room
page and in the panel.

### The fix

A read-only field that was focused by the pointer (mouse, pen or touch) draws no ring.

- On `pointerdown`, the field gets `data-pointer`. It loses it on `blur`.
- One rule: `input[readonly][data-pointer]:focus-visible { outline: none }`.
- Tab still draws the ring. Someone on the keyboard needs to see where they are.
- A click still selects the whole link, ready to copy. Only the ring goes.
- **Portal:** two listeners in `PORTAL_JS`, and the rule in `PORTAL_CSS`. That covers every read-only field: the
  room page's invite link and the front page's links.
- **Panel:** the two handlers on the invite link in `inviteSection`, and the rule in `STYLE`.

*Or:* no ring on read-only fields at all, Tab included. The selected text would then be the only sign of focus.
It's simpler, but a keyboard user loses the ring, so I don't recommend it.

### Test

E2E: "a click on the invite link draws no focus ring, and Tab does". It reads `outline-style` after a click (none),
and after focusing the control before the field and pressing Tab (solid).

- The portal's room page and front page: `@this-server`.
- The panel: `@this-client`, in Chrome, Firefox and WebKit, since that's where the fix runs in other people's
  games.

## Feature 1. The whole link on hover (decision 0)

- **One line, as now.** When the link doesn't fit, its end shows "…" (`text-overflow: ellipsis`, while the field
  isn't focused), so you can see there's more.
- **The bubble.** While the pointer is over a field whose link doesn't fit, the whole link shows right under it:
  - wrapped, in the field's font;
  - on the card's background with a thin edge, light and dark;
  - drawn over what is below it (the hint on the room page, Share and QR code in the panel);
  - clicks go through it (`pointer-events: none`);
  - hidden from screen readers (`aria-hidden`), since the field already gives them the link.
- **Also** while the field has focus from the keyboard. On a phone, a tap on the field shows it, since phones count
  a tap as hover, until the next tap elsewhere.
- **Where:** the room page's invite link, every link on the front page, and the panel's invite link.
- A front-page link that leaves characters out shows them as dashes in the bubble, as in the field.

**How:** the field goes in a `<span class="link">` with a `<span class="whole" aria-hidden="true">` holding the
link. On `pointerenter` and `focus`, the wrapper gets `cut` when `input.scrollWidth > input.clientWidth`. The CSS
shows `.whole` for `.cut:hover`, and for a `.cut` whose field has keyboard focus (`:has()`, which all three engines
have had since 2023). `.row > input { flex: 1 }` becomes `.row > .link`.

**Test** (E2E): on the room page at 1100 px the test link doesn't fit (69 characters). Hovering shows the bubble
with the whole link, and moving away hides it. On the front page at the same width, the link fits, and no bubble
shows. In the panel, the link never fits in 300 px, and hovering shows it. Tags as in issue 1.

## Feature 2. The panel outside a room

In `renderSetup` (`client/src/ui/panel.ts`).

**The title:** "Multiplayer – Powered by p3p2.me".

- "Multiplayer" in the title's bold, as now.
- "– Powered by" in the panel's small text (12 px, the soft colour), so the title fits.
- "p3p2.me" in the font from decision 1, bold, 16 px, in the text's colour.
- I used an en dash where the prompt has a hyphen.
- Measured on this machine (Noto Sans, the widest of the common system fonts): 222 px of the 244 px the title has.
  A 320 px phone leaves 240.
- `setBody` takes the title as nodes as well as a string. The dialog's name stays "Multiplayer", for screen
  readers and the tests.
- The title's p3p2.me isn't a link: the third line has the link. *Or:* make it a link too.

**The text:**

1. Share one small p3p2 relay server.
2. Already have one? Open the invite link from the server.
3. No server yet? p3p2.me says how to get one.

- They are written as sentences, with full stops and a capital O, where the prompt has none.
- They are in the panel's normal text. Lines 2 and 3 are a pair of questions, so they look the same.
- "p3p2.me" in line 3 stays the link to `https://p3p2.me/`, in a new tab, as plan 6 made it.
- Why the last room ended still shows above them.
- The *Join?* question keeps "Multiplayer" as its title, since the prompt asks only for single-player mode.
  *Or:* the same title there.

**Test:** "outside a room the panel says …" (`chat.spec.ts`, `@this-client`) checks the new title and the three
lines, and the link as now.

**Docs:** `docs/integrate.md`, line 21 ("Opened without a link, it says to open one …"), gets the new words.

## Feature 3. The UI (decision 3)

I took screenshots of the portal's pages (log in, the dashboard, a room, the front page) and of the panel (outside
a room, *Join?*, in a room), light and dark, at 1100 px and on a 390 px phone. Then I went through them with the
frontend skill. The portal and the panel are quiet and consistent, and nothing is broken. These are the places
that could do better, in the order I'd do them.

### The portal

**3a. The link gets a line of its own on a phone.** At 390 px, the room page shows 16 characters of the link,
beside Copy and Open. Under 520 px, the row wraps: the link takes the whole width, and the buttons go under it. The
same on the front page, with Play.

**3b. The QR code beside the hints, on a wide screen.** On a laptop the invite card is about 480 px tall, mostly
the 220 px QR code, and it pushes **Players online** below the fold. That's the card an owner watches. Over 640 px,
under the link's row: the hints and **Renew invite** on the left, the QR code on the right. The link's row keeps the
whole width. Phones stay as now.

**3c. "The game" is bigger than "Settings".** It's an `h3` inside the Settings card, and the portal styles no
`h3`. So it gets the browser's 1.17 em, larger than the card's own `h2` (1.05 rem). The fix: `h3` a step below `h2`,
with a line above it, since **Save** doesn't apply to it.

**3d. Empty pages say what to do.**

- The dashboard: "No rooms yet." becomes "No rooms yet. Create one below, for the game you want to play."
- The front page: "No room is open right now." becomes "No room is open right now. Whoever runs this server can
  send you an invite link."

### Both

**3e. One colour for p3p2.** The favicon is teal (`#0d7d6e`, "p3p2's teal" in `assets.ts`), but links and buttons
are green (`#2f6f3e`). Green is also the colour of "online" and "host". So the brand has two colours, and a button
looks like a status.

- Links and buttons in the teal: `#0b6e61` in light mode, 5.6:1 on the page (the favicon's own `#0d7d6e` is
  4.3:1 on the read-only fields' tint, too little for text), and `#2cc7b1` in dark mode, 8.5:1.
- Green only for "online" and "host" (`--ok`).
- In the portal and in the panel. The favicon doesn't change.

**3f. One wordmark.** The portal header's "p3p2" is set in the same font as the panel's "p3p2.me" (decision 1). The
server and the panel then carry one mark.

### The panel

**3g. The invite link on a line of its own,** with **Copy**, **Share** and **QR code** in one row under it. Now, on
a computer (which has no Share), **QR code** sits alone on a row. The link shows about 30 characters beside Copy;
with the line to itself, about 40.

**3h. Leave on the "on <server>" line,** at its right, instead of on a row of its own. That's one row less in a
panel that has to fit a phone on its side (the 480 px rule in `style.ts`).

### Considered, and left as they are

- **Web fonts.** The portal is self-hosted, and its CSP loads no fonts at all. Fonts from Google would tell Google
  about every visitor, and bundling one adds 20 to 40 KB a weight to the server. The panel has 15 KB in all. So the
  system fonts stay, and the one bold choice is the wordmark (3f).
- **A players list that updates by itself** on the room page (now: **Refresh**). It's a feature, not a look: the
  page would have to poll, or keep a socket.
- **Motion.** There is none, and none is added.

### Tests

- 3a: at 390 px, the room page's link is at least 90% of its card's width. `@this-server`.
- 3c: `The game` is drawn smaller than `Settings`. `@this-server`.
- 3d: `server/test/server.test.ts`, the dashboard and the front page without rooms.
- 3e: the look tests check that a button's colour is not the "online" badge's. Portal `@this-server`, panel
  `@this-client`.
- 3g, 3h: the panel tests find things by role and label, so they don't need to change. One check that **Leave** is
  on the line that names the server. `@this-client`.
- 3b and 3f only move and restyle things.

## Feature 4. The New room card (decision 2)

**The card** (`dashboardPage` in `server/src/http/pages.ts`):

1. Game URL.
2. Room name | Most players.
3. **On this server's front page**, starting at Not shown, with the hint: "The front page is this server's
   address, for anyone who isn't logged in. Only games on p3p2 0.2 or later ask for the characters left out."
4. **Create room**.

"Other sites that may use this room", its text box and its hint go. A room starts with its game's own site, and
more are added in its Settings, as `docs/host.md` and `docs/self-host.md` already say.

**The server** (`portal.post('/rooms')` in `server/src/http/portal.ts`):

- It reads `front` as Settings does: `off`, or a number in `FRONT_HIDDEN`. Anything else is Not shown.
- It no longer reads `origins`. A dashboard still open from before the update could send them, and they'd be
  ignored: the owner adds them in Settings.
- `NewRoomForm.origins` becomes `front`, so a refused form keeps the choice.
- `store.createRoom` writes `front`. The column has been there since migration 5, so no migration is needed.
- The room gets its invite when it's made, as now, so it's on the front page at once.

**Tests:**

- `server/test/server.test.ts`, "portal: creating rooms":
  - `origins` comes out of the create call, and out of the list of refused forms;
  - new: a room made with `front=0` is on the front page for a visitor, with its whole link;
  - with `front=4`, it shows without the last 4 characters;
  - with `front=9`, it isn't shown.
  - The origins checks are already in the settings test.
- E2E: "a room made onto the front page is there at once" (`@this-server`), next to the front-page tests in
  `chat.spec.ts`.
- `createRoom` (`e2e/tests/helpers.ts`) fills only Game URL, Room name and Most players. That works with this
  portal and with the 0.1.2 image's.

**Docs** (`docs/host.md`):

- "Getting a room" gets a step: **On this server's front page**, Not shown unless you want friends to find the room
  there (see "Friends who come to the server").
- "**Not shown**, which every room starts with" becomes "which a room starts with, unless you choose otherwise when
  you create it".

## Feature 5. Settings

In `roomPage`, the Settings form in this order:

1. Room name | Most players.
2. **On this server's front page**, with its hint.
3. Sites that may use this room.
4. Players on different versions of the game.
5. Invite parameter.
6. **Save**.

That's the New room card's order too (feature 4). Fields keep their names, so the tests don't change.
`server/test/server.test.ts` checks the order: `id="front"` comes before `id="origins"`.

## Size

| gzip | Now (`ai/next_6.md`) | Budget | Plan 7 |
|---|---|---|---|
| entry | 1.92 KB | 2 KB | nothing |
| room client + panel | 14.03 KB | 15 KB | about +0.3 KB: the bubble (0.15), the ring (0.05), the title and its font (0.1); 3e, 3g and 3h move things |
| one file | 18.00 KB | 20 KB | about +0.3 KB |
| local room, smooth | 1.72, 1.38 KB | 1.8, 1.5 KB | nothing |

The portal has no budget. I'll give the numbers in `ai/next_7.md`, and I won't raise a budget without asking you.

## The e2e runs

As in plans 5 and 6. `@this-server` for the portal's tests: the ring, the bubble, 3a, 3c, 3e and the New room card.
`@this-client` for the panel's: the ring, the bubble, the title and its lines, 3e and 3h. When 0.2.0 is published,
`@this-server` comes off them with the others.

## Order of the work

1. Issue 1: the ring, in the portal and the panel, and its test.
2. Feature 1: the bubble, and its test.
3. Features 4 and 5: the New room card, the server's `front`, the Settings order, and their tests.
4. Feature 2: the panel's title and lines.
5. Feature 3, as decided, with decision 1's font.
6. The docs: `docs/host.md` and `docs/integrate.md`.
7. The checks:
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`;
   - `npm run test:pack`, `npm run e2e`, then `npm run e2e:all`.
8. `ai/next_7.md`, with screenshots of the pages before and after, described in words.

As always, I don't commit or push.

## Yours, outside the repo

- **p3p2.me** still says that a player "pastes a room URL into a game". Since plan 6, everyone joins through the
  invite link, and the panel has no room URL field. Its tagline, "player 1 brings their own small relay server",
  fits the panel's new first line.

## Not in this plan

- A drawn wordmark (decision 1).
- A players list on the room page that updates by itself (feature 3).
- **Still waiting**, from `ai/next_3.md` to `ai/next_6.md`:
  - bug 1;
  - the chat-key test that fails about once in ten runs;
  - saved values that change during a gap;
  - `crypto.subtle` on plain http;
  - the packing figures;
  - what the other player sees of a hit;
  - the unread count for games with their own button;
  - rally asking for the characters left out;
  - a setting for the number of tries;
  - an invite that doesn't run out;
  - refusing room URLs from 0.1 games;
  - lookalike names across scripts;
  - a library helper for things whose path can be worked out.
