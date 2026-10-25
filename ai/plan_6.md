# Plan 6: a smooth ball for guests, one player per browser, names, fields that look fixed, new tabs, one way in

This answers `ai/prompt_6.md`. In short:

- **Issue 1. The ball glitches on a guest.** I measured it. The cause is in the example (`examples/host-ball/`), not
  in the library. A guest takes each of the host's reports as where the ball is *now*, then moves it on by its own
  timer, so at every report (15 a second) the ball lands up to one timer tick out, a different amount each time.
  The fix: date each report, move the ball on by its age, and draw the ball where it is at each frame.
- **Issue 2. Two tabs, two players.** The server makes a second tab of the same browser a second member with the
  same player id. `docs/protocol.md` and a server test say so on purpose. `docs/play.md`, `docs/testing.md` and
  `docs/integrate.md` promise the opposite: one player, one place. The fix is in the server: the newer tab takes the
  player's place, and the older one says "This room is now open in another tab." That message is already there.
- **Feature 1. Fields that can't be changed look different** from fields that can, in the portal and in the panel.
- **Feature 2. Names.** A room refuses a name that one of its members already has (ignoring case), and names keep
  only letters, digits, spaces and a few marks.
- **Feature 3. New tabs.** **Play** on the front page opens the game in a new tab. **Open** on the room page has
  done that since plan 5, and a test checks it.
- **Feature 4. Everyone joins through the invite link,** the owner too. The panel has no room URL field, and no
  Remove or End buttons. The room page has no room URL card. Removing a player and ending the game happen in the
  portal, which already has **Kick** and **End session**.

Issue 1 and feature 1 touch little. Feature 4 is most of the work: most of the e2e tests start by pasting a room
URL into the panel, so their helpers change.

Answer the decisions first. Each one has a recommendation, and "Implement plan 6" without answers means the
recommendations.

## Decisions for you

**0. One release.** *Recommended:* plans 5 and 6 go out together as 0.2.0. 0.2.0 isn't out yet, and feature 4
takes `p3p2.host()` away (decision 3). One release that changes the API is easier on game developers than two in a
row.

- Or: 0.2.0 now with plan 5, and plan 6 as 0.3.0.

**1. Two tabs of one browser.** *Recommended:* the newer tab takes the player's place in the room. The older tab
is told `replaced`, and its panel says "This room is now open in another tab." It goes back to playing alone.

- This is what the docs already promise, and what a duplicated tab does today. A new tab with the invite link
  does the same.
- The player's id and its secret already prove it's the same player, so nobody can take another's place this way.
- Or: the newer tab is refused while the older one is connected ("You're in this room in another tab"). But a tab
  that froze, or a laptop whose lid was shut, would keep the player out for the 30 s grace period.

**2. Which names.** *Recommended:* letters and digits of any language, spaces, and `. - _ '`. No emoji or symbols.
At most 24 characters, as now, with at least one letter or digit.

- Two names count as the same when they differ only in case, or in the width of the characters (NFKC): "Ada",
  "ADA" and "ａｄａ" are one name.
- Lookalike letters from different scripts (a Latin a, a Cyrillic а) still count as different. Catching those
  takes Unicode's confusables table, which is too large for the client.
- The server keeps only the allowed characters of a name. So a 0.1 game's "Ada 🎮" arrives as "Ada", and "🎮" alone
  becomes "Player 3", as an empty name does today.
- Or: only `a`–`z`, `0`–`9`, spaces and `. - _ '`, with accents dropped (José becomes Jose). No lookalikes at all,
  but no names in other scripts.
- Or: any characters, as now. Only the rule about names already in the room.

**3. The client's API.** *Recommended:* 0.2 has no room URL anywhere. `p3p2.host()`, `room.isMod`, `room.kick()`
and `room.end()` go, along with the error codes `room-url` and `room`.

- A game calls `p3p2.start()` or `p3p2.join(invite)`, as guests' games always have.
- rally, which hosts from its own menu, loses its room URL field and its Remove and End buttons.
- `docs/integrate.md` gets a short "From 0.1 to 0.2" list of what changed, with plan 5's `coast` among it.
- Or: keep `p3p2.host()` and the mod API for games with menus of their own, and take only the panel's field out.
  But then a game can still remove players and end the game, which the prompt puts in the portal only.

**4. 0.1 games on a 0.2 server.** *Recommended:* the server still takes a room URL from a 0.1 game, along with its
host's Remove and End. The protocol doesn't change.

- Such a host had the owner's secret all along. Its panel keeps the field until the game moves to 0.2.
- `e2e:all` runs every released client against this server. Keeping this path keeps the promise in `0aec7cf`:
  every newer server takes every released client.
- Or: the server refuses kick and end from games. A 0.1 host's buttons would then do nothing it could see.

**5. Games with their own `urlParam`.** Today a host's game tells the server its page and the URL parameter it
reads invites from, and the portal builds the room's link with them. With `host()` gone, the portal builds every
link from the room's game URL and `?room=`. A game made with `urlParam: 'join'` would get links its client ignores.

*Recommended:* the room's settings get **Invite parameter**, `room` by default. One column (migration 6), one field,
and the link uses it. A link a 0.1 host's game asked for still uses that game's own page and parameter.

- Or: `urlParam` goes from the client in 0.2, and the invite always comes in `?room=`.
- Or: nothing now, and the docs say that the portal's links use `?room=`.

## Issue 1. The ball on a guest's screen

### What I measured

I wrote a script (not in the repo) that does what the e2e tests do: a server, the examples' site, the owner
creating a room for `host-ball`, Ada hosting and Grace joining, each in a browser profile of their own, in headless
Chrome. Then for 4 s, at every animation frame on both pages, it records where the ball is drawn.

- **LAN-like:** both pages connect through `e2e/tools/lag-proxy.ts` with 1 ms each way and up to 3 ms of jitter.
- **One measure:** the frames whose step is more than 25% off the step the ball's speed gives.
- **The other:** how far Grace's ball is from Ada's at the same moment, in the field's units. The field is 400
  wide, drawn at most 640 px wide, so a unit is about 1.6 px.

One run each:

| | Ada (host): frames off | Grace (guest): frames off | Grace from Ada, p95 |
|---|---|---|---|
| Speed 1, LAN-like | 12 of 240 (5.0%) | 33 of 240 (13.8%) | 2.7 (about 4 px) |
| Speed 4 (the tests'), LAN-like | 13 of 240 (5.4%) | 27 of 240 (11.2%) | 10.9 (about 18 px), and a jump of up to 17 from one frame to the next |
| Speed 1, no proxy | 12 of 240 (5.0%) | 13 of 240 (5.4%) | 2.7, steadily |

The last row is why one machine looks fine and two don't. Without the proxy, both pages' timers tick together, and
Grace is a steady tick out. With a few ms of jitter, as between two computers, which side of a tick each report
lands on changes, and Grace's ball goes back and forth by a tick's travel.

### Why

1. **A report is taken as where the ball is now** (`ball = data`). The guest's next tick moves it on by the time
   since its *previous* tick, so the guest ends up between 0 and one tick out (16 ms of travel: 2.7 units at speed
   1, 11 at speed 4). The amount changes at every report.
2. **The ball is drawn where the last tick left it.** The 60-a-second timer and the screen's frames drift past each
   other, and about one frame in twenty moves two ticks. That's the host's 5%, on every page.
3. **A guest doesn't know about the bricks.** Its ball flies on into a brick until the next report, up to 1/15 s
   later, and then jumps back. The hit op then puts the ball where it was at the hit (`ball = [...op.ball]`), which
   is in the past by the time the op arrives.

Nothing in the library adds to this: messages are passed on as they come, without batching, and the measurement
shows no frame where the ball stood still.

### The fix, in `examples/host-ball/index.html` only

- **The host dates its reports:** `[x, y, vx, vy, at]`, with `at = Math.round(room.now())`. A report also goes out
  at once when the ball turns off a brick, or when a kick turns it, not only at the 15-a-second pace.
- **A guest moves each report on by its age** (`room.now() - at`, at most 250 ms) when it arrives. Between reports
  it moves the ball as the host does, bouncing off the bricks still standing, but it never submits anything. So it
  doesn't fly into a brick. The host's ops still say which bricks fall.
- **Every page draws the ball where it is at the frame's time:** from the last tick, moved on by the time since
  then (walls only, and never more than a tick). The timer stays, since animation frames stop in a background tab.
- **A guest takes the ball from a hit op** only when replaying (the log at load) or when the host has gone quiet,
  not live.
- `window.game.drawn`: where the last frame drew the ball, for the test.

*Or:* draw the guest's ball with `Smooth`, which draws 120 ms in the past between reports. It's simpler, but it
cuts the corner at each bounce (up to about 5 units at 15 reports a second), and a brick would fall 120 ms before
the drawn ball reaches it. The ball's path is straight lines and bounces, so carrying it on from a dated report is
exact, and `Smooth` is for things nobody can predict.

### Test

`e2e/tests/host-ball.spec.ts`: "the ball moves as evenly on a guest as on the host" (`@alone`, since it times
frames). It runs through the lag proxy at 1 ms and 3 ms of jitter, at speed 4, and samples `game.drawn` every frame
for 4 s on both pages.

- On each page, at most 2% of frames are off by more than 25% (now 5% and 11 to 14%).
- Grace is within 1 unit of Ada at p95 (now 2.7 to 10.9).
- I'll set the limits from the first runs, and give the before and after numbers in `ai/next_6.md`.

### Docs

`docs/integrate.md`, section 6, and `docs/sharing-state.md`, "What one page runs for everybody", get a bullet each:
a report says where something was when the host sent it. Send `room.now()` with it and carry it on by its age, or
draw it with `Smooth`. Drawn as it arrives, it is up to a frame out, by a different amount each time. The host-ball
page's own paragraph says the same in a line.

## Issue 2. Tabs of one browser (decision 1)

Today, in `hello` (`server/src/core/hub.ts`), a connection takes over a member only with that member's resume
token, which lives in the tab's `sessionStorage`. A duplicated tab copies it. A new tab, from the invite link or
**Play**, has none, so it joins as a new member with the same player id. The player id lives in `localStorage`,
which every tab shares.

**The change:** a connection whose player id (with its secret) already has a member in the room takes that member
over, as a resume does.

- The older connection is told `bye replaced`. 0.1 clients know it too, so this is the same for every client.
- The member keeps its id, its name and its place in the order. Nobody is told `member+` or `member-`.
- The newer tab gets the whole log, since it has no copy of its own.
- It gets in even when the room is full, since the place is its own.
- The member's `mod` follows the newer connection's auth (a room key or an invite).
- **The host role.** A page that closes gives the role up, and a page that reloads comes back as a guest. A tab
  that takes a place over has none of the older page's game either. So when a member whose connection is still
  open is taken over while it is the host, the role passes on as at a reload: to whoever is best placed, if anybody
  else is here. This applies to a duplicated tab too.
- The same player in two different rooms is still a member of each.
- A tab that was offline when the other took over, and comes back, takes the place back. The last connection wins,
  and a tab that was replaced never tries again, so the two don't go back and forth.

**Tests** (`server/test/hub.test.ts`):

- "The same player in a second tab is a second member" becomes the opposite.
- New: no `member+`; a full room; the host role passing on, or staying with a host that is alone; two rooms; a wrong
  secret is still `player`; `mod` from the new auth.

E2E: "two tabs of one browser are one player: the newer takes the place, and the older says why" (`@this-server`).
It opens the invite in a second page of the same profile and joins. The room still lists one Ada, and the first
page shows the message.

**Docs:**

- `docs/protocol.md`, Player id: "Two tabs of one browser are one member: the newer connection takes it over, and
  the older is told `bye replaced`." Plus a row in "Added within protocol 1".
- `docs/play.md`, `docs/testing.md` and `docs/integrate.md` are right after this, as written. I'll re-read them.

## Feature 1. Fields that can't be changed

Today `input[readonly]` looks like every other input, in the portal (`server/src/http/assets.ts`) and in the panel
(`client/src/ui/style.ts`). The panel's chat log, which nobody types in, is styled as a field too.

- **Fields that can be changed** stay as they are: the field's background, a border, and the focus ring.
- **Fields that can't** get a tinted background (a new `--fixed` colour, between the card and the line, light and
  dark) and no border. Their text can still be selected and copied, and focusing one still selects it all.
- **Where:**
  - in the portal: the invite link on the room page and on the front page;
  - in the panel: the invite link, and the chat log.
- **Test:** in the portal and in the panel, light and dark (`colorScheme`), a read-only field and an editable one
  have a different background and border. Tags: `@this-server` for the portal's, `@this-client` for the panel's.

## Feature 2. Names (decision 2)

**The characters.** `cleanName` in `protocol/src/frames.ts` keeps only the allowed characters, after what it
removes today. A new `nameKey(name)` gives the form two names are compared in (NFKC, lower case). The server and
the client share both.

**The same name twice.** In `hello`, a new member whose name's key matches a member of the room is refused with a
new error code, `name`: "Someone in this room already has that name". Members in their grace period count.

- The player isn't a member, and nobody else hears of the try.
- A player taking its own place over (issue 2), or resuming, is never refused: it keeps its name.
- A name is free again when its member has left, after the grace period.
- An empty name still becomes `Player <id>`, and if a member already has that name, the next free number.

**The client:**

- `client/src/errors.ts`: "Somebody in this room already has that name. Choose another."
- The panel's *Join?* shows it, keeps the dialog open, and puts the cursor in the name field.
- When the player leaves the name field, it shows the name as it will be used, without the characters left out.
- `join(invite, { ask: false })` rejects with code `name`. rally's word list gets it.
- A member who reconnects after its grace period, and finds its name taken meanwhile, is refused like any other
  refusal on the way back: the room closes with `lost`. That's rare.

**0.1 clients** are cleaned and refused by the server the same way. They show "Something went wrong (name)." Their
*Join?* stays open with the name field, so the player can try another.

**Tests:**

- `protocol/test/frames.test.ts`: the characters, the 24, "🎮" to empty, and `nameKey`.
- `server/test/hub.test.ts`: refused ignoring case and width; not refused when the same player takes its place
  over; free after the grace period; `Player n` skipping a number whose name is taken.
- E2E: "a player who picks a name already in the room is asked for another, and gets in with it" (`@this-server`,
  `@this-client`).

**Docs:** `docs/play.md` (what a name may have, and a row for the refusal), `docs/api.md` (`name`), and
`docs/protocol.md` (the name rules, `error name`, and its row in "Added within protocol 1").

## Feature 3. New tabs

- `frontPage` in `server/src/http/pages.ts`: **Play** gets `target="_blank" rel="noreferrer"`, like **Open**.
- **Open** on the room page has opened a new tab since plan 5, and "the owner's room page has an invite link …,
  and it opens the game in a new tab" checks it. Nothing changes there.
- The front-page test in `e2e/tests/chat.spec.ts` waits for the new tab, and plays in it. `docs/play.md` and
  `docs/host.md` say "in a new tab".

## Feature 4. Everyone through the invite (decisions 3 to 5)

### The client

- **The panel outside a room** (`client/src/ui/panel.ts`, `renderSetup`): no name field, no room URL, no button.
  It says: "To play with friends, open the invite link one of them sent you." Under that, in small text: "Running a
  p3p2 server? Open the invite link on the room's page in its portal." It still shows why the last room ended.
- **The panel in a room:** no × beside the others' names, and no **End for everyone**. The invite link to pass on
  stays, for everyone in the room.
- **The API** (decision 3):
  - `p3p2.host()` goes from `client/src/index.ts`, and `Controller.host`, `checkRoom` and `savedRoomUrl` from
    `core.ts`;
  - `isMod`, `kick()` and `end()` go from `types.ts`, `room.ts` and `local.ts`;
  - `room-url` and `room` go from `errors.ts`.
  - The client then needs nothing of `room-links.ts` but `inviteUrl`.
- **`urlParam`** (decision 5) stays, and the docs say to set the same parameter in the room's settings.

### The server's portal

- **The room page** (`roomPage` in `pages.ts`):
  - The **Room URL** card goes: the input, its Copy, and its hint.
  - The invite card says: "Open it to play, and send it to your friends: everyone joins this room through it, you
    too."
  - Without an invite: "No invite is open. Create one to play, and to let friends in."
- **The dashboard:** "A room belongs to one game. Paste its URL into that game's multiplayer menu to host" becomes
  "A room belongs to one game. Its page has the invite link that you and your friends join with."
- **The page at a room's address, for a visitor** (`publicRoomPage`): it no longer says to paste the address into
  the game. "This is the page of a p3p2 room for game.example.com, for its owner. To play, open the invite link you
  were sent." Plus Owner log in.
- **Rotate key** keeps its place. The key is now the room page's address, and what a 0.1 game hosts with. Its
  question: "Give this room a new key? This page moves to a new address, games on p3p2 0.1 can't host with the old
  one, and the session ends."
- **Kick** and **End session** are already there. The badge "has the room URL" stays, for 0.1 hosts.
- **Invite parameter** (decision 5):
  - migration 6 adds `rooms.param`;
  - the field goes in Settings, checked with `URL_PARAM_RE`;
  - `inviteLinkFor` uses `invite.param ?? room.param ?? 'room'`.
  - Hint: "The parameter the game reads its invite from: room, unless its developer says otherwise."
- **Unchanged:** `/api/v1/room` and `/api/v1/room/invite`, which 0.1 games host with (decision 4), and `hello` with a
  room key.

### A consequence to know

The owner used to get a fresh invite by pasting the room URL. Now, once a room's invite has run out (12 h after
the room empties), it has none until the owner presses **Create invite** on its page, and sends the new link. Until
then, the room is off the front page too. The room page already has that button. `docs/host.md` says so.

### Clients from 0.1

- They join through the portal's invite link like everyone. 0.1 clients have always handled invite links.
- Their panel still has the room URL field, and hosting with it still works (decision 4).
- `docs/host.md` stops mentioning the field, and has one line: a game on p3p2 0.1 also takes the room page's
  address as its room URL.

### The examples

- **rally** (`examples/rally/`): the hosting part of its menu goes, along with Remove and End. In their place: "Open
  an invite link from a p3p2 server to play somebody." Its own *Join?* stays.
- **The examples' texts** that say "paste a room URL" (`host-ball`, `chat.html`, `cards.html`, `turns.html`,
  rally's page) say to open an invite link.
- The duel takes the client from jsDelivr `@0.1` until the release, as now. In the tests it gets the client under
  test.

### The e2e tests

Most tests begin with `createRoom` and then `host`, which pastes the room URL into the panel. The helpers change, so
that most tests don't need to.

- **`createRoom`** returns the room's invite link from its page. On a 0.1 server, which makes none when a room is
  created, it presses **Create invite** first. It reads `roomUrl` from the page's own address, for the tests that
  still need the key (upgrade, rally's 0.1 path).
- **`host(page, invite, name)`** opens the invite in that page and says yes. The first in is the host, as before.
- **Tests behind the lag proxy** put the proxy's address into the invite link's server, where they used to put it
  into the room URL.
- **A test whose room was created for one page and hosted from another** gets a room for the page it plays on. The
  link now comes from the room's game URL, not from the host's page.

These work with every client and every server the runs use:

- 0.1 clients take invite links.
- The 0.1.2 image gets **Create invite**.

The tests that are about the room URL in the panel, or about the panel's Remove and End, change:

- `chat.spec.ts`:
  - "outside a room the panel says to open an invite link, and has no room URL" (`@this-client`);
  - "the owner plays through the room's invite link, and removes a player and ends the game from the portal"
    (all clients);
  - "the players' panels have no Remove and no End" (`@this-client`);
  - "the room page has no room URL" (`@this-server`).
  - The tests of a pasted room URL's errors (another site, unreachable) become the same errors through an
    invite.
- `rally.spec.ts`: hosting becomes joining through the invite. Remove and End go to the portal. The `unreachable`
  and `mixed` words are checked through an invite to such a server.
- `duel.spec.ts`: the panel opened with the game's own button is checked by its words outside a room, not by the
  Room URL field (`@this-client`).
- `world.spec.ts`: `hostAgain` opens the invite.
- `e2e/node/client.test.ts`: the `isMod` checks go. The server tests already cover kick and end.
- The other spec files change only where they call the helpers: `arena`, `cards`, `game`, `host-ball`, `restart`,
  `turns` and `upgrade`.

### Docs

| Where | What changes |
|---|---|
| `README.md` | What a host and a player do (lines 9 and 14), "In two minutes", and the lag proxy: edit the port in the invite link, where it used to be the room URL |
| `docs/host.md` | "Getting a room" and "Inviting", rewritten around the room page's invite link; removing players and ending the game in the portal; the invite running out; the 0.1 line |
| `docs/play.md` | Names, two tabs, Play in a new tab |
| `docs/integrate.md` | "Try it"; the bullet from issue 1; "From 0.1 to 0.2" (decision 3) |
| `docs/testing.md` | "By hand" |
| `docs/self-host.md` | First room: Open the invite link and send it; room URLs become the rooms' pages where they are addresses |
| `docs/security.md` | The room key's row: the portal's page of the room, and hosting for 0.1 games; the line on links in addresses |
| `docs/protocol.md` | A note that from 0.2 clients join with invites only, and the key is for older ones; issue 2 and `name` |
| `docs/api.md` | `host`, `isMod`, `kick`, `end`, `room-url` and `room` go; `name` comes; `urlParam` points at the setting |
| `client/README.md` | Its room URL line |

A test checks that `docs/api.md` names every member of the public types. The doc-snippet test type-checks the
docs' code against the client's types, so a snippet that still calls `host()` fails until it changes.

## Size

| gzip | Now (`ai/next_5.md`) | Budget | Plan 6 |
|---|---|---|---|
| entry | 1.95 KB | 2 KB | a little less: `host()` goes |
| room client + panel | 14.79 KB | 15 KB | less: the room URL check, hosting, Remove and End go; the name words, the field style and the new words come |
| one file | 18.64 KB | 20 KB | less |
| smooth | 1.38 KB | 1.5 KB | nothing |

`ai/next_5.md` left 0.21 KB in the panel's budget. Feature 4 should give back more than features 1 and 2 take. I'll
give the numbers in `ai/next_6.md`. I won't raise a budget without asking you.

## The e2e runs

The tags work as in plans 4 and 5. `@this-server`: the takeover, the names, the room page without its card, Play in
a new tab, the portal's field style. `@this-client`: the panel without a room URL or mod buttons, the panel's field
style, the name words.

- When 0.2.0 is published, `@this-server` comes off them, and off plan 5's three.
- `@this-client` stays while 0.1 clients are in the clients run.

## Order of the work

1. Issue 1: `host-ball`, its test, before and after numbers.
2. Issue 2: the takeover in the hub, and its tests.
3. Feature 2: `cleanName` and `nameKey`, the server's check and default names, the client's words and field, and
   the tests.
4. Feature 4:
   - the client: panel, API, errors;
   - the portal: room page, dashboard, visitor's page, Rotate key, Invite parameter;
   - rally and the examples' texts;
   - the e2e helpers, then the tests that change.
5. Features 1 and 3: the field styles, Play in a new tab, and their tests.
6. The docs.
7. The checks:
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run size`;
   - `npm run test:pack`, `npm run e2e`, then `npm run e2e:all`.
8. `ai/next_6.md`.

As always, I don't commit or push.

## Releasing (yours)

With decision 0, plan 5's steps (`ai/plan_5.md`, "Releasing (yours)") are the steps for 0.2.0:

1. `npm version 0.2.0 --workspaces --include-workspace-root --no-git-tag-version`.
2. `0.1` becomes `0.2` in `deploy/docker-compose.yml` and in the script tags of `client/README.md`,
   `docs/integrate.md` and `examples/duel/index.html`.
3. Commit and push. Once CI is green, `npm run build && npm run e2e:all`. Then tag.
4. After the tag, `@this-server` comes off as above.

## Not in this plan

- **An invite that doesn't run out**, so that the owner's link works every evening without a visit to the portal.
- **Pasting an invite link into the panel**, for a player who has the game open already. Opening the link does it.
- **Refusing room URLs from 0.1 games** (decision 4's alternative), once 0.1 is old enough to drop.
- **Lookalike names across scripts** (decision 2).
- **A helper in the library for things whose path can be worked out** (a ball between bounces), carried on from a
  dated report. Only host-ball needs it for now.
- **Still waiting**, from `ai/next_3.md` to `ai/next_5.md`:
  - bug 1;
  - saved values that change during a gap;
  - `crypto.subtle` on plain http;
  - the packing figures;
  - what the other player sees of a hit;
  - the unread count for games with their own button;
  - rally asking for the characters left out;
  - a setting for the number of tries;
  - the p3p2.me comment in `logo.ts`.
