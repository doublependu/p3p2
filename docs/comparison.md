# Other projects like p3p2

p3p2 is one way to give a static web game multiplayer. This page lists the others we found, what each shares with
p3p2 and where it parts from it, so that a game can pick the one that fits.

What is here was read from each project's own README, docs or listing in October 2026. Small projects change fast;
check the link before counting on a line.

## Five questions that tell them apart

| Question | p3p2's answer |
|---|---|
| **Who runs the server?** Yourself, a company, or nobody (the browsers connect to each other) | Yourself: one Node.js process with SQLite, behind Caddy |
| **Does the server read what the game sends, or run its rules?** | Never. It reads the envelope only ([design-philosophy.md](design-philosophy.md)) |
| **What is still there when everybody has left?** | A value for the room, one for each player, and a log of changes in one order |
| **Where is the referee, and what happens when it leaves?** | The host's page, one of the players; the role passes on by itself |
| **How does a friend get in?** | An invite link and a QR code, from a panel the page gets for free |

## The closest

| Project | Shares with p3p2 | Parts from it |
|---|---|---|
| [**Playroom Kit**](https://docs.joinplayroom.com/) | The game runs in the browsers. A value per player and per room (`setState`), a host (`isHost()`, `transferHost()`), calls between pages (`RPC`), a lobby the page gets for free, room codes | A hosted service, with a free tier. Its docs offer no server of your own |
| [**Croquet / Multisynq**](https://github.com/croquet/croquet) | The server only puts messages in one order and passes them on, and cannot read them: traffic is encrypted with the session's password. Open source (Apache-2.0), and its server (the *reflector*) runs in Docker ("Croquet-in-a-Box") | Another way to write a game: every browser runs the same deterministic model, so there is no host. By default it goes through Multisynq's network, with an API key |
| [**webxdc**](https://docs.webxdc.org/spec/sendUpdate.html) | Static HTML apps, and somebody else carries the messages. `sendUpdate` is a saved log everybody gets in one order, like p3p2's log | The server is a messenger (Delta Chat, for one), and the invite is the chat itself. An app should assume one update every 10 seconds; anything faster goes through an [experimental realtime channel](https://webxdc.org/docs/spec/joinRealtimeChannel.html), whose messages a late joiner never gets, with presence from [`@webxdc/realtime`](https://npmjs.com/package/@webxdc/realtime) |
| [**playweft**](https://github.com/playweft/playweft) | Its own words: "turning static web games into connected multiplayer experiences". Rooms, invite links (`/r/<roomId>`), a host that passes on, open source (MIT) | The server is the referee: each game's rules are written in Lua and run on Cloudflare (Workers and Durable Objects), and the game runs in a sandboxed frame. That is the third thing [p3p2 is not for](design-philosophy.md#what-p3p2-is-not-for). Early |
| [**antics.gg**](https://mcpservers.org/servers/antics-gg/antics-mcp) | `joinRoom({})`, a room's state kept by the host with a part for each player, writes gathered to about 20 a second, an invite link and a QR code | Hosted, and made for games an AI agent writes and deploys. Without an account, rooms hold 8 and last a day. Read from its listings, not its own docs |
| [**GameRelay SDK**](https://github.com/gamerelay/sdk/releases) | Links that join a room (`?join=`), rooms that only a link opens | Appears hosted (its links are on gamerelay.io). Alpha |

## With no server at all

These connect the browsers to each other over WebRTC, and use a public service only to introduce them.

| Project | What it is |
|---|---|
| [**Trystero**](https://npmjs.com/package/trystero) | Rooms from an app id and a room id, in a few lines. Peers find each other through Nostr, MQTT, Supabase and others, or a relay of your own |
| [**PeerJS**](https://peerjs.com/) | The most used wrapper around WebRTC: connections for data, sound and video |
| [**NetplayJS**](https://www.npmjs.com/package/netplayjs) | Rollback netcode for fast games, with matchmaking |
| [**boardgame.io**](https://npmjs.com/package/@boardgame.io/p2p) | A framework for games in turns; its experimental P2P transport keeps the state in the host's browser |
| [**NetArcadeJS**](https://github.com/Mr-Caden/NetArcadeJS) | A shared screen (a TV) runs the game, and phones are the controllers |

What they have in common, beside p3p2:

- **Nothing to run**, and one hop instead of two: a message goes from one browser to the other. That cuts the delay,
  not the host's advantage ([design-philosophy.md](design-philosophy.md#what-p3p2-is-not-for)).
- **Nothing kept.** When the last page closes, the game is gone.
- **Some networks block them.** A player behind a strict firewall needs a TURN server, which is a server to run
  after all.
- **Every browser talks to every other**, and browsers limit how many such connections a page holds: Trystero's
  README asks for small rooms.

## Small projects

| Project | What it is |
|---|---|
| [**multipayer**](https://github.com/LordNikos/multipayer) | A relay of about 100 lines of Python for exactly two players. The first page is the host and keeps the state; `redact()` hides a field (the other player's hand) before sending. No reconnection |
| [**Carbonfreezer/multiplayer**](https://github.com/Carbonfreezer/multiplayer) | A relay in Rust that knows no game, and one client that is the game's server, for board games compiled to WebAssembly. No reconnection; a fuller version runs board-game-hub.de |
| [**relay**](https://github.com/mantou132/relay) | A relay in Rust that never reads its JSON, saves it in SQLite and replays it after a reconnection, between two endpoints |
| [**Parlor**](https://github.com/kevingomez93/parlor) | Rooms with shared state, presence and Yjs, on Elixir and Postgres; "a PartyKit-style alternative". Not for games in particular |
| [**Railway's WebSocket game server**](https://railway.com/deploy/nodejs-websocket-game-server) | A template: a relay with rooms, msgpack, rate limits and an origin allowlist. No invites |

## Servers you program yourself

These carry what p3p2 does not: a referee on the server, strangers, public lobbies. Each needs code of the game's
own on the server, or a company's service.

| Project | What it is |
|---|---|
| [**Colyseus**](https://github.com/colyseus/colyseus) | A game server where the server holds the state: rooms, matchmaking, state sent to every client. MIT, run it yourself or in their cloud |
| [**Nakama**](https://github.com/heroiclabs/nakama) | A large game backend: accounts, matchmaking, leaderboards, chat, realtime. Apache-2.0 |
| [**PartyKit / PartyServer**](https://github.com/cloudflare/partykit) | A server class the game writes, run once for each room on Cloudflare's Durable Objects, with storage for the room and a client (`partysocket`) that reconnects and holds what is sent meanwhile. Open source (ISC), deployed with Wrangler to your own Cloudflare account. Nothing for presence, a host or invites: a relay that broadcasts what it gets is a few lines, and the rest is the game's to write. The hosted platform at partykit.io [shuts down on 23 October 2026](https://blog.partykit.io/posts/hosted-platform-shutdown) and deletes the room data left on it; PartyServer is what it points to next |
| [**Liveblocks**](https://liveblocks.io/blog/whats-new-in-liveblocks-february-2026) | Presence and shared storage for collaborative apps; hosted. Its sync engine and dev server became open source in February 2026 |
| [**Supabase Realtime**](https://supabase.com/features/realtime-broadcast) | Broadcast and presence over WebSockets, which you can run yourself (Elixir, with Postgres). It does not promise that every message arrives |
| [**geckos.io**](https://github.com/geckosio/geckos.io) | UDP-like messages between a Node.js server and browsers, over WebRTC, for fast games |

## What none of them has together

Each project above has some of these; we found none with all of them:

- **A server of your own that knows no game.** Playroom, antics.gg and GameRelay are services; playweft, Colyseus
  and Nakama run the game's rules; PartyServer runs code the game writes, on Cloudflare.
- **What a game keeps, without a server of the game's own**: a value for the room, one for each player, and a log in
  one order.
- **A host chosen by the server, and passed on** when that page goes.
- **A room made for one game**: its site, its `game.id` and its version policy, set in a portal by whoever runs the
  server.
- **An invite a static page can give** (link, QR code, *Join?*) from a panel of its own, in a client under 2 KB
  until a room opens.

Playroom Kit is the nearest for the game's side, and Croquet the nearest for the server's.
