# What protects what

p3p2 is for playing with people you know. This page says what its keys and checks keep out, and what they do
not, so that nobody counts on more than there is.

## The secrets, and what each opens

| Secret | Who has it | What it opens | What it does not |
|---|---|---|---|
| **The owner's password** (`P3P2_OWNER_PASSWORD`) | Whoever runs the server | The portal: creating, changing and deleting rooms, renewing invites, clearing what a room saved | Nothing in a room by itself |
| **A room URL** (its key, 130 random bits) | The owner, and whoever the owner gives it to | Hosting in that room: joining it, creating its invite link, kicking a member, ending the session (a *mod*) | Other rooms. The owner can change a room's key or delete the room. |
| **An invite link** (its code, 50 random bits) | Everybody the host sends it to | Joining the room, as a player who cannot kick or end | Hosting. An invite lasts 12 hours after the room empties, and the owner (or a mod) can renew it, which ends the old one. Join attempts are rate-limited per address. |
| **A player's secret** | The player's browser, kept in its storage | Being the same player next time: their saved values are theirs | Proving who somebody is. It is "trust on first use": the first browser to use a player id owns it. Clearing the browser's storage makes a new player. |
| **The stats token** (`P3P2_STATS_TOKEN`) | Whoever runs the server | `/api/v1/stats`: the server's counters | Anything in a room |

The two links people pass round, the room URL and the invite, are the only places a secret is in an address. The
others travel in a header or in the first frame of the connection.

## The game's site

A room is made for one game's address, and the server takes connections for it only from pages on that site
(their `Origin`). It stops other websites from using your server and your rooms.

It is not authentication:

- The `Origin` is the scheme, the host and the port, not the path. Two games on one site
  (`example.github.io/game-a/` and `…/game-b/`) look the same to the server. **A room is held to the game it was
  first played with** (its `game.id`), so the other is refused; but a game's id is the game's own word, and a page
  on the same site can claim any id it likes.
- A game in a portal's frame (itch.io, say) runs on the portal's site, and so does every other game there.
- A program outside a browser can send any `Origin` it likes. The room's key and the invite are the real locks.

## The players

**Friends can cheat.** Every page runs code its player controls. The host's game is the referee, and the host is one
of the friends; a guest can say it hit what it missed. A game for strangers needs a server that runs the game,
which p3p2 is not.

**Every member gets what the room keeps**: every player's saved values, the whole log, everybody's presence. Do
not put in them what a player should not see. `room.sendEach` sends a member something nobody else's page gets,
but the host made it and saw it.

**What a member sends is somebody else's data.** The server checks the envelope of every frame and its size; it
never reads `data`. The game must check that what arrives is what it expects before it uses it.

## The server's operator

Whoever runs the server (usually the friend who sent the link) can read everything that passes through it and
everything it saved, and sees the players' IP addresses. The players see only the server's address, not each
other's. The server's log records joins and leaves, never what was sent.

[self-host.md](self-host.md) says how to remove a room's saved data, and everything.

## Limits that stop a member, or a stranger, from flooding the server

Per member: 90 frames a second (with a burst of 120) and 256 KB a second; a frame of at most 64 KB; presence of at
most 1 KB. Per room: 256 KB of saved values, 1 MB of log, 64 KB of message tails, 16 members by default. Per
address: one new connection a second with a burst of 40, and five portal or API calls a second. All of them are
server settings ([README](../README.md#server-settings)).
