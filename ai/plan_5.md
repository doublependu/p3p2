# Plan 5: the logo checked, rooms on the server's front page, Smooth that only draws between, unread chat on the button

This answers `ai/prompt_5.md`. In short:

- **0. The logo commit** (`7c20ebf`): checked while writing this plan. Apart from the logo and the words about it,
  it changes nothing. It also moved some code, to make room for the logo in the entry's 2 KB, and that move
  changes no behaviour. Two small things could be tidied; both are optional.
- **1. Rooms on the front page.** The server's address shows anyone the rooms its owner picked, each with its
  invite link. A room can hide the last 2, 3, 4 or 8 characters of its link, and the game then asks for them. The
  owner's room page always has an invite link, and the link opens the game in a new tab.
- **2. Smooth.** `coast` defaults to 0. I checked that this is all it takes for `Smooth` to only interpolate.
- **3. Unread chat.** A red badge on the logo, with the number of chat lines that came while the panel was closed.

Item 1 is most of the work and all of the risk. Items 0, 2 and 3 are small.

Answer the decisions first. Each one has a recommendation, and "Implement plan 5" without answers means the
recommendations.

## Decided

Nothing yet.

## 0. The logo commit: checked

I read the whole diff of `7c20ebf`, then built and measured `4a3b4bf` (the commit before it) beside today's `main`.

What it changes:

- **The mark.** `client/src/logo.ts` builds an SVG node by node. It replaces 👥 on the stand-in button
  (`client/src/index.ts`) and on the panel's pill (`client/src/ui/panel.ts`). The button's name stays
  "Multiplayer", so screen readers and every test find it as before.
- **The portal.** The mark is in the header, and there is a favicon at `/assets/favicon.svg`. The favicon is served
  like `portal.css` and `portal.js`, before the headers middleware. `raw(MARK)` writes a constant, so `html`'s
  escaping loses nothing.
- **Words.** 👥 becomes "the multiplayer button" in the docs, in the examples' text, in a test comment, and in the
  doc comment of `UiOptions.button`.
- **`protocol/src/links.ts` split in two.** `formatInvite`, `inviteUrl`, `parseRoomUrl` and `roomUrl` move to
  `room-links.ts` without changes. `@p3p2/protocol` still exports all of them. Only the subpath
  `@p3p2/protocol/links` lost them, and the client's entry imports nothing from it except `inviteFromUrl`. The
  package is private, so no code outside the repo imports it.

Why the split: links.ts was shared by the entry and the core, so those four functions ended up in the entry chunk.
`p3p2.js` built from `4a3b4bf` contains `parseRoomUrl`'s `/room/` pattern, and today's doesn't. Moving them out
made room for the logo:

| gzip | `4a3b4bf` | today's `main` | budget |
|---|---|---|---|
| entry (`p3p2.js`) | 1.86 KB | 1.94 KB | 2 KB |
| room client + panel | 13.92 KB | 14.17 KB | 15 KB |
| one file (`p3p2.iife.js`) | 17.77 KB | 18.09 KB | 20 KB |

The other chunks are unchanged, apart from the QR code chunk, which went from 2.55 KB to 2.52 KB.

- **Public types** (`client/dist/types`): identical, apart from that one doc comment.
- **Checks on today's `main`:** `npm run lint`, `npm run typecheck`, `npm test` (159 tests), `npm run build` and
  `npm run size` are clean. `npm run e2e`: 89 passed, 1 known bug (bug 1's test), none failed, in 3.8 min. That is
  the same result as in `ai/next_4.md`.

**Verdict:** no function of p3p2 changed apart from the logo.

Two small things, both optional:

1. **The stand-in button's mark sits in the game's page, not in the panel's shadow root.** Its `fill` and `opacity`
   are attributes, and any rule in the game's CSS for `svg` or `path` (`path { fill: #333 }`) beats an attribute.
   👥 had no such exposure.
   - *Recommended:* set both as inline styles in `logo.ts`. A game's ordinary rules don't override inline styles,
     and the mark's width and height are already set that way.
   - The pill's mark is inside the shadow root and safe already, but doing it the same way for both is simpler.
2. **`logo.ts` says the shapes are "p3p2.me's favicon".** Nothing in the repo mentions p3p2.me. If it is a site of
   yours, the comment can stay. If not, those words come out.

## Decisions for you

1. **Which rooms are on the front page.** *Recommended:* each room has its own setting, and every room starts off
   the front page. That covers the rooms that exist when the server is upgraded and the rooms created after. The
   owner puts a room on the front page from the room's page.
   - An upgrade must not publish anything that wasn't public before: room names, games, invite links.
   - While no room is on it, `/` goes to the log-in page, as today. A server that doesn't use the front page looks
     the same as before.
   - Or: new rooms start on the front page with 4 characters hidden, and the form that creates a room has the
     setting too.

2. **The hidden characters stay the same through new invites.** *Recommended:* a room on the front page with n
   hidden characters keeps the same n characters. Every invite the server makes for the room ends with them.
   - So friends learn them once ("k3f9"). The server's address and those characters are all they need, next
     week too.
   - New characters come from Renew invite (in the portal, or `renew: true` from a host), and from hiding more of
     the link or taking the room off the front page (see "The owner's room page").
   - They stay the same when the invite expires 12 h after the room empties, after End session, and after a
     restart.
   - Or: the hidden characters are just the end of the current invite, and change with it. There is nothing to
     store, but after every new invite the host has to pass new characters on.

3. **How many wrong tries a room takes.** The hidden characters are a short secret, so the server has to limit
   guesses per room, not only per address. Today one address may look up 5 invites a second, and at that rate 2
   hidden characters (1,024 possibilities) last a few minutes.

   *Recommended:* a room takes 10 wrong tries at once, then one more every 6 minutes.
   - When a room has no tries left, every try for it is refused for the time being, including the right
     characters. Answering the right ones would tell a guesser which ones were right.
   - Members already in the room aren't affected, and neither is anyone who comes with the room URL.

   How long a stranger who knows the server's address needs on average, trying non-stop:

   | Hidden | Possibilities | On average |
   |---|---|---|
   | 2 | 1,024 | 2 days |
   | 3 | 32,768 | 2 months |
   | 4 | about a million | 6 years |
   | 8 | about a million million | never |

   The cost: while such a stranger keeps trying, they keep the room shut to new players. The owner can then renew
   the invite, which gives new characters, or take the room off the front page.
   - Or: other numbers. A setting can come later, if a server ever needs one.

4. **The version.** *Recommended:* release 0.1.2 from today's `main` before plan 5 is carried out, then release
   plan 5 as 0.2.0.
   - The default of `coast` changes what a game draws. A game on `@0.1` (the script tag) or `^0.1` should not
     change by itself.
   - The database gets new columns. A 0.1 server refuses a database that a 0.2 server has opened.
     `docs/self-host.md` already says to back up before moving to 0.2.
   - Links with hidden characters need a 0.2 client. A 0.1 client can't read them, and its game opens as if there
     were no invite.
   - 0.1.2 brings plan 4's fixes (and the logo) to `@0.1` and to `p3p2/p3p2:0.1`.
   - Or: one release, 0.2.0, without 0.1.2. Players on 0.1 then go without plan 4's fixes until their game or
     server moves to 0.2.

5. **The examples, with `coast` at 0.** *Recommended:* arena, rally and world take the new default, with no change
   to their code. That way they show what a game gets without asking.
   - The arena test "a figure moving at an even speed is drawn going steadily, never back" measures this, at 0 ms
     and through 150 ms. I'll compare its numbers before and after in `ai/next_5.md`.
   - If it fails, arena gets `coast: 250` back with a comment saying why, and I tell you.
   - Or: all three keep `coast: 250`, and only new games get the new default.

## 1. Rooms on the front page

### What a visitor sees

A visitor who opens the server's address (`https://p3p2.example.com/`) without logging in sees:

- **Before setup:** "This server is not set up yet", as today.
- **With no room on the front page:** the log-in page, as today (decision 1).
- **Otherwise:** the rooms on the front page, in the dashboard's order. Each one shows:
  - its name;
  - the game's site;
  - how many are playing out of how many may, or "full";
  - its invite link, with a **Play** button that opens the game in the same tab, since the visitor came to play.
- **For a room with hidden characters:** the link ends in one dash per hidden character:
  `https://game.example.com/?room=p3p2.example.com/789xyz----`. The line under it says: "The game asks for the
  last 4 characters. Whoever invited you has them."
- **At the bottom:** "Owner log in". A logged-in owner gets the dashboard at `/`, as today.

The front page never shows the room URL (its key), the hidden characters, or players' names. A peek at an invite
gives the host's name; the front page doesn't.

When a room on the front page has no invite (because it expired), the page makes one. A room still has at most
one invite at a time. Lookups from one address are rate-limited, as they are for the room page.

### The owner's room page

- **The invite link is always there.** Opening the page makes an invite when there is none, and the "Create
  invite" button goes away.
- **The link opens the game in a new tab.** The link itself has `target="_blank"`. Copy and the QR code stay.
- **A new setting: "On this server's front page".** The choices are: Not shown; Shown, with the whole invite link;
  Shown, without its last 2 (3, 4, 8) characters. These are the counts the prompt lists, and n is the one chosen.
  - When a room goes on the front page, its hidden characters are the last n of its current invite. Links already
    sent keep working, including the host's.
  - **Showing more keeps the invite.** That means going from not shown to shown, or hiding fewer characters.
  - **Hiding more, or taking the room off the front page, makes a new invite and new characters.** Part of the
    link was public until then. Without a new invite it would be easier to guess than the setting says, or no
    longer covered by the limit on wrong tries. The old link stops working for new players, as with Renew invite,
    and members in the room stay.
- **The invite card shows the hidden characters,** when there are some: "On the front page the link is shown
  without its last 4 characters: **k3f9**. Friends who come that way type them."
- **The dashboard:** the "invite open" badge becomes "on the front page". Every room the owner has opened will
  have an invite now, so "invite open" says little. A line under the list says that rooms marked this way are
  listed at this address for anyone who isn't logged in.
- **The room remembers the game page and the URL parameter its host last hosted from.** Today these are stored
  with each invite, so an invite the server makes by itself has neither. Its link would be the game URL with
  `?room=`, which is wrong for a game that uses another parameter.

### The link and the client

- **The invite parameter** is `<server>/<code>`, and the code's last characters may be dashes, one per hidden
  character. The code is 10 characters in all, and at least 2 of them are real.
- **`protocol/src/links.ts`:** `parseInvite` accepts such codes, and `Invite.code` then ends in dashes.
- **The panel's *Join?* for such an invite:**
  - It says "You were invited to a room on p3p2.example.com." and shows a field for "The last 4 characters",
    the name field, Join (disabled until the room is found) and Play alone.
  - Once all 4 are typed, the panel looks the invite up, the way it checks a pasted room URL.
    - Found: "Join Friday night on p3p2.example.com? Hosted by Ada · 2 players".
    - Wrong: "Those aren't the right characters."
    - Too many wrong tries: the `rate` message.
  - Typed characters are read the way the code's alphabet reads them: capitals as lower case, o as 0, i and l as 1,
    and spaces are dropped. So "K3F9" read out over the phone works.
- **After joining,** the player's panel shows the whole link to pass on, as it does for every guest today. Anyone
  in the room knows the characters anyway.
- **A game with its own *Join?*** (`ui: false`, or `join(invite, { ask: false })`): the dashes tell it how many
  characters to ask for, and it puts them in place of the dashes before calling `peek` or `join`. Given a code
  that still has dashes, `peek` and `join` reject with a new error code, `hidden`. `docs/api.md` shows how in
  three lines. No new field: the dashes are the API.
- **A 0.1 client** doesn't read a link with dashes, and its game opens as if there were no invite. The docs say
  that a game needs a 0.2 client for these links.

### Wrong tries (decision 3)

- **One check, in the hub,** covers both ways in: the look-up (`GET /api/v1/invite`) and the connection's
  `hello`.
- **Which room a try counts against:** take a room on the front page with n hidden characters. A code counts as a
  try for that room when its first 10 − n characters match the room's invite. A code that matches no such room
  counts only against its address, as today.
- **The limit:** each such room has a bucket of 10 tries, kept in memory, which refills by one every 6 minutes. A
  wrong try takes one. When the bucket is empty, every try for the room is refused with `rate`, including the
  right one. The look-up answers 429, and `hello` fails with `rate`. Old clients already know that code.
- **A restart refills the buckets.** Only the owner can restart the server, so this gives a guesser nothing.

### Server changes

- `server/src/store/migrations.ts`, the next migration, adds four columns to `rooms`:
  - `front`: NULL when the room isn't shown, otherwise 0 to 8, the number of hidden characters;
  - `hidden`: the hidden characters, `''` when there are none;
  - `page` and `param`: the game page and URL parameter the host last hosted from.

  Existing rooms come out of the migration not shown (decision 1).
- `server/src/core/types.ts`, `server/src/store/sqlite.ts`: the new fields, and a query for the room a try is for.
- `server/src/core/ids.ts`: `newInviteCode(hidden)` draws random characters and appends `hidden`. With 8 hidden,
  only 2 characters are random, so a code that is already taken is drawn again.
- `server/src/http/api.ts`:
  - `ensureInvite` uses the room's hidden characters, and its page and parameter;
  - `renew` makes new characters;
  - the look-up goes through the hub's check.
- `server/src/core/hub.ts`: the check, and `hello` goes through it.
- `server/src/http/portal.ts`:
  - `/` for visitors;
  - the room page makes the invite;
  - the setting, with the rule for when it makes a new invite;
  - Renew makes new characters.
- `server/src/http/pages.ts`: the front page; the room page's invite card and the new setting; the dashboard's
  badge.

### Client and protocol changes

- `protocol/src/links.ts`, `protocol/src/room-links.ts`: read and write codes with dashes.
- `client/src/core.ts`: `peek` and `join` refuse a code that still has dashes, with `hidden`.
- `client/src/ui/panel.ts`: the characters field in *Join?*, and filling them into the code.
- `client/src/errors.ts`: the words for `hidden`.
- `client/src/types.ts`: the doc comment of `Invite.code`.

### Tests

Server (`server/test/server.test.ts`, `server/test/hub.test.ts`, with the test clock):

- `/` without logging in lists only the rooms on the front page, with whole or dashed links as set. Its HTML
  contains no room key and no hidden character. With no room on it, `/` still goes to `/login`.
- The room page and the front page both make an invite when there is none.
- The hidden characters stay the same through the invite's expiry, End session and a restart. Renew, hiding more,
  and taking the room off the front page all make new ones. Showing more keeps the invite.
- Ten wrong tries for a room, through the look-up and `hello` together. The eleventh, even with the right
  characters, is refused with `rate`, and 6 minutes later one more try goes through. Codes for another room, or
  for no room, don't count against it.
- A database from 0.1 opens with every room off the front page.

E2E:

- "a friend who opens the server's address finds the room, types the hidden characters, and plays with the host"
  (`@this-server`, `@this-client`): first wrong characters, then the right ones, then the same world as the host.
- "the owner's room page has an invite link before anyone has hosted, and it opens the game in a new tab"
  (`@this-server`).
- "a game with its own Join? fills in the hidden characters itself" (`@this-server`, `@this-client`): `join` with
  `ask: false`, called from `page.evaluate`, the way `chat.spec.ts` calls `host`.
- `e2e/tests/upgrade.spec.ts`: after the upgrade, `/` lists none of the rooms (`@docker`).
- `e2e/tests/helpers.ts`, `createRoom`: go to `/login` rather than `/`. Once one test has put a room on the
  front page, `/` no longer leads to the log-in form for the tests that run after it on the same server.
  `/login` works on 0.1 servers too.

### Docs

- `docs/host.md`: a section "Friends who come to the server", covering the setting, the characters, what renewing
  does, and what to do when a stranger keeps trying.
- `docs/play.md`: opening the server's address, and typing the characters.
- `docs/self-host.md`: what the server's address shows visitors now.
- `docs/security.md`: the invite row gets the front page, the hidden characters, and the limit on wrong tries.
- `docs/protocol.md`: the dashed link, and `rate` for a room's wrong tries.
- `docs/api.md`: `Invite.code`, the `hidden` error, and how a game fills in the characters.
- `README.md`, "In two minutes": one sentence saying that friends can also open the server's address and pick the
  room.

## 2. Smooth: interpolation only, by default

I checked this by reading `get()` in `client/src/smooth.ts`. `coast` is the only thing in `Smooth` that draws
something past its last report:

- **Past the last report,** it carries on only `if (before && this.coast > 0)`. With 0, the thing is drawn at its
  last report and stays there.
- **Between two reports,** `u` is at least 0 and below 1, so the thing is always drawn in between.
- **Before the first report it keeps,** it is drawn at that report.
- **Angles and rotations** use the same `u`.
- **The extra delay for late reports,** the one other thing that moves the moment being drawn, only ever draws
  further in the past, never ahead.
- **The tests agree.** "With no coasting it stops at the last report" uses `coast: 0`. "Reports that arrive
  late..." also runs with `coast: 0`, and finds the speed steady.

What it costs: when a report comes later than the delay, the thing stands at its last report until the report
arrives. Today it carries on and then comes back. The extra delay for late reports makes such stops rare.

Changes:

- `client/src/smooth.ts`:
  - the default becomes `options.coast ?? 0`;
  - the header comment and `SmoothOptions.coast` say that by default `Smooth` only draws between reports, and
    that `coast` is for a game that would rather guess ahead for a moment.
- `docs/api.md`, the `new Smooth` row: `coast` (0).
- `client/test/smooth.test.ts`, a new test: by default nothing is drawn past its last report, whether the reports
  stop or arrive late. The existing tests already pass `coast` where they need it.
- The examples: decision 5.

## 3. Unread chat on the button

Today the pill shows the mark, the number of players, and an orange dot when chat came while the panel was
closed. The dot becomes a red badge on the mark's corner, showing how many such lines there are: 1 to 9, then 9+.

- **What counts:** lines from other players that arrive while the panel is closed. That includes lines that came
  during a gap: the room passes them on when it is back, and never twice.
- **What doesn't count:** the player's own lines, and whatever was already there when the room opened.
- **What clears it:** opening the panel (the button, the chat key, or `p3p2.open()`), and leaving the room.
- **The button's name** is "Multiplayer, 3 unread messages" while there are unread lines. Tests find it by
  "Multiplayer", as before.
- **Games with their own button** (`ui: { button: false }`) **or no panel** (`ui: false`) see none of this. See
  "Not in this plan".
- **Files:** `client/src/ui/panel.ts` and `client/src/ui/style.ts`.
- **A test** in `e2e/tests/chat.spec.ts` (`@this-client`): Grace's pill shows 3 after Ada's 3 lines, 9+ after 10,
  and nothing once Grace opens the panel. Ada's own lines don't count on her pill.

## Size

| gzip | Today | Budget | Plan 5 adds |
|---|---|---|---|
| entry | 1.94 KB | 2 KB | reading the dashed code: a few dozen bytes |
| room client + panel | 14.17 KB | 15 KB | the characters field, the badge, `hidden`: a few hundred bytes |
| smooth | 1.38 KB | 1.5 KB | nothing |

If the entry goes over, I loosen its check of the link: it accepts any 10 characters of the code's alphabet and
the dash, and the core checks the rest. I won't raise a budget without asking you.

## The e2e runs

The tags work as in plan 4. New tests that need this server get `@this-server`, and new tests that need this
client get `@this-client`.

- Once 0.2.0 is published, `@this-server` comes off them.
- `@this-client` stays as long as released 0.1 clients are in the clients run.

## Order of the work

0. The two logo things, if you want them.
1. Smooth.
2. The unread badge.
3. The server: the migration, the setting, the characters, the room page, the front page, wrong tries, and their
   tests.
4. The protocol and the client: the dashed link, *Join?* with the characters field, the API, and their tests.
5. The e2e tests and the docs.
6. The checks:
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`;
   - `npm run test:pack`, `npm run e2e`, then `npm run e2e:all`.
7. `ai/next_5.md`.

As always, I don't commit or push.

## Releasing (yours)

Following decision 4:

1. **Now, before plan 5:** 0.1.2 from today's `main`, as `ai/plan_4.md` describes ("Releasing (yours)").
2. **After plan 5:** 0.2.0.
   - Run `npm version 0.2.0 --workspaces --include-workspace-root --no-git-tag-version`.
   - Since this is a new minor version, `0.1` becomes `0.2` in the image tag of `deploy/docker-compose.yml` and in
     the script tags of `client/README.md`, `docs/integrate.md` and `examples/duel/index.html`
     (`CONTRIBUTING.md`).
   - Then as always: commit and push; once CI is green, `npm run build && npm run e2e:all`; then tag.

## Not in this plan

- **The unread count for games with their own button.** Such a game can already count lines from `room.chat.on`
  itself. `room.chat` could give the count, if a game asks for it.
- **The hidden characters in the host's panel.** A host who came with the room URL sees the whole link, but not
  which characters the front page hides. The owner sees them in the portal.
- **A setting for the number of wrong tries.**
- **rally asking for the hidden characters in its own menu.** The e2e test above covers that API path.
- **What `ai/next_3.md` and `ai/next_4.md` list:** bug 1, saved values that change during a gap, `crypto.subtle` on
  plain http, the packing figures, and what the other player sees of a hit.
