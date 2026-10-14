# Design philosophy

p3p2 is meant to carry any game a few friends play together in their browsers, without knowing what the game is.
This page says how it stays that way, and where that stops: the kinds of game it is not for.

## How p3p2 stays generic

### What the server knows

- **Nothing about games.** It has no game-specific code and no game-specific settings. A room is a name, a key,
  the sites that may use it, a member limit and a version policy.
- **Only the envelope.** It reads each message's type, channel, receivers and flags, and never looks inside
  `data`, which is any JSON value or raw bytes ([protocol.md](protocol.md)).
- **Any number of games.** One server carries any number of rooms, each for its own game.

### Where the game runs

In the players' browsers. One member's page is the **host**: the first to join, and after them the earliest who
is here. It runs what must be decided in one place (enemies, bots, a ball) and is the game's referee. The server
names the host and passes the role on; it never runs a rule of any game.

The price is written down: the host is one of the players, and friends can cheat ([security.md](security.md)).

### What a game is given

A few building blocks, each for a kind of state, not for a kind of game: a value for the room, a value for each
player, presence, a log of changes in one order, messages, the host, and a part for each player (`sendEach`). A
genre is a combination of them: [sharing-state.md](sharing-state.md#by-kind-of-game) shows which each kind of game
uses.

- **Every block is opt-in.** The smallest game uses `room.send` and `room.on`, and nothing else.
- **What is shaped by a kind of game stays out of the way.** `Smooth` (drawing others between updates) and `pack`
  (shrinking large saves) are imports of their own, outside the 2 KB a page loads before a room is opened.

### The rules for a change

1. **Look for the fix in the game first, then in the client, and in the server last.**
2. **The server still reads only the envelope.** A change that needs it to know what a game is, is not made.
3. **One game is not enough to change the server.** It takes two games, or one game and a plain class of others.
   `room.sendEach` came from a world too big to send everybody; it went in because cards dealt face down need the
   same thing, and [`examples/cards.html`](../examples/cards.html) shows it without a game around it.
4. **A change arrives whole**: the validator in `protocol/`, a server test, [protocol.md](protocol.md), and a page
   in `examples/`.
5. **Then the examples' tests run again**, and an example that had to change is counted.

The measure of whether this works is how often a game had to change because p3p2 moved. Why each part is there,
and the kind of game that asked for it:

| What | Asked for by |
|---|---|
| `room.offer()`: "whoever comes first decides the world", in one step | Worlds raised from a seed, which two people opened at the same moment |
| `Smooth`, for drawing what arrives a few times a second | Anything drawn from reports: a walker, a car at speed, the units of a host |
| `pack`, and a log that loads and saves in the background | A world of placed blocks, whose save outgrew a frame |
| A panel without a button of its own, for games that have one | Games whose every corner was taken |
| Member states (`here`, `away`, `lost`) | Enemies run by the host, which went for a player whose page was in the background |
| `room.sendEach` | A world too big to send everybody, and cards dealt face down |
| Presence that carries its time, and `Smooth` that uses it | A car followed at speed, and every game that draws others from presence |
| Ops that wait while the connection comes back | Games in turns, and a game across several pages, which each had to keep their own list |
| A room held to its game | Two games on one site |

### Frozen

The protocol is frozen as protocol 1. What may change without a new number, and what needs one, is in
[protocol.md](protocol.md#changes-within-protocol-1).

## What p3p2 is not for

The line runs less by genre than by who plays and how many. A shooter among friends fits; the same shooter on
public servers among strangers does not.

A kind of game is out if carrying it would need any of these:

1. **A referee that nobody in the room controls.** The referee is the host's page, and the host is one of the
   players. A neutral one means the rules of the game on the server.
2. **More than a room of friends.** A room takes at most 64 members (16 by default), and what one
   page runs for everybody runs in one browser tab.
3. **A server that reads what the game sends**, to decide anything.

### Not for these

| Kind of game | Why not |
|---|---|
| **Games among strangers where winning matters**: ranked play, matchmaking, stakes, items worth trading, leaderboards across rooms | Any player can cheat, the host most of all; stopping it needs a referee on the server that knows the rules. And there are no public lobbies: a room is made by its owner and joined by invite. |
| **Massive worlds**: .io games with public servers, a canvas shared by thousands | A room holds at most 64. The host's page would simulate everything and send each player its view, and `sendEach` takes at most 64 parts, from a member who may send 90 messages a second. Sending each player only what is near them from the server would mean reading positions. |
| **Browser strategy games played among thousands**, where armies march and fields grow while you are away | Strangers, an economy, and a world that acts while nobody is online. The server runs no game's code. |
| **Competitive twitch games**: ranked fighting games and shooters | Every message makes two hops, through the server, and the host's page judges. Among friends that is fine: in a fast duel over one ball that belongs to whoever it is heading towards, nobody loses a point to the delay, and the cost is a jump on the other screen. Where fairness is the point, it is not. A direct connection between browsers would cut one hop, not the host's advantage; p3p2 has none. |
| **Games played by voice or video** | Sound and pictures are not game state, and need another kind of server. p3p2 has text chat. |

Carrying one of these takes a game server beside p3p2, not a feature of it.
