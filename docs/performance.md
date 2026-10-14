# Performance

What one small p3p2 server carries, measured with the load generator in `bench/`.

Measured on 2026-10-09, on one machine, with the server in a container held to one CPU and
512 MB. How, and why a rented VPS will give other numbers, is under
[How it was measured](#how-it-was-measured).

## The short version

**One room of 20 players uses a small part of the server.** The target is under 25 % of one CPU
and under 10 ms of added latency (p99).

| Profile, 20 players in one room | CPU | Memory | Latency p99 | Sent by the server |
|---|---|---|---|---|
| Chat: a line from each player every 10 s | 1.2 % | 93 MB | 2.7 ms | 7 KB/s |
| Presence: players walking, positions 10 times a second | 5.7 % | 96 MB | 0.8 ms, plus the batching | 241 KB/s |
| Host snapshots: 4 KB from the host to everyone 15 times a second | 11.3 % | 96 MB | 1.8 ms | 1.17 MB/s |
| Saved ops: 2 from each player every second, into the room's log | 5.1 % | 96 MB | 1.8 ms | 106 KB/s |

**The limits are far above what the project is for.** Rooms of 20 were added until CPU passed
80 % or p99 latency passed 50 ms:

| Profile | Within the limit at | Over it at | What gave first |
|---|---|---|---|
| Chat | 256 rooms, 5,120 players | 272 rooms | Latency: the heartbeat to all connections at once |
| Presence | 104 rooms, 2,080 players | 112 rooms | CPU |
| Host snapshots | 56 rooms, 1,120 players | 60 rooms | CPU |
| Saved ops | 104 rooms, 2,080 players | 112 rooms | CPU and latency together: the database's syncs to disk |

**What follows from the numbers:**

- **Memory is not a concern for the server.** It takes 93 MB with nobody connected and 116 MB
  with 2,000 idle players, a small part of the container's 512 MB. A rented machine's system
  needs memory as well: see
  [Why these numbers are not a VPS's numbers](#why-these-numbers-are-not-a-vpss-numbers).
- **Bandwidth runs out long before CPU.** A room of 20 costs 0.8 GB an hour of presence, or
  4.1 GB an hour of 4 KB snapshots. At the CPU limits above the server would send 11 to 65 MB
  every second. See [Bandwidth](#bandwidth).
- **`ws` stays.** Under load about half of the server's CPU time is the kernel writing frames
  to sockets, which any WebSocket library has to do; the `ws` library itself is 5 to 9 %. See
  [Where the CPU time goes](#where-the-cpu-time-goes-and-the-choice-of-ws).
- **What gives first, under far more load,** is work the server does for everyone at the same
  instant. See [What gives first](#what-gives-first).
- **Saving costs little CPU and, now and then, a pause.** Writing 2,500 ops a second took
  under 2 % of the server's busy time. But every so often the database syncs to disk, and for
  those 20 to 60 ms on this machine's disk the server relays nothing. See item 4 of
  [What gives first](#what-gives-first). A shooter's room next to 400 players who save stayed
  under 50 ms on one core: [A room that saves beside one that relays](#a-room-that-saves-beside-one-that-relays).
- **A day of traffic leaves memory where it was.** In the 24-hour soak test RSS ended 1.4 %
  above its start and was level for the last 12 hours, with nothing lost and no errors. See
  [Soak](#soak).

KB, MB and GB are powers of 1024 throughout.

## How it was measured

- **The server** ran in a Docker container held to one CPU and 512 MB
  (`docker run --cpus=1 --memory=512m --memory-swap=512m`), built from `deploy/Dockerfile`, with
  its database on disk. That is the size of the smallest VPS one can rent.
- **The players** were simulated by `bench/`, a Node program on the same machine, outside the
  container. Each simulated player is one WebSocket that speaks the real protocol: it says
  `hello`, pings every 10 seconds as the client library does, and sends what its profile says.
  The generator used 4 threads; the machine has 12 cores, so it did not compete with the server
  for its one CPU.
- **Rooms** were made the way an owner makes them: the generator logs in to the portal, creates
  the rooms, and asks the REST API for each room's invite. In every room one member joins with
  the room key and the others with the invite.
- **The server ran as shipped**, with three settings changed, none of which touches the traffic
  being measured: `P3P2_CONNECT_RATE` and `P3P2_API_RATE` were raised, because all of
  a generator's players come from one address, and `P3P2_MAX_ROOMS` was raised for the
  limit search. `P3P2_STATS_TOKEN` was set, which switches on `GET /api/v1/stats`
  (`docs/protocol.md`), where the generator reads the server's side of each measurement.
- **Every table below came from a fresh container**, so none inherited another's memory.

### What the columns mean

| Column | Measured where | Meaning |
|---|---|---|
| CPU | Server | CPU time the server process used, as a share of one CPU, over the measurement |
| Memory (RSS) | Server | Resident memory of the server process at the end of the measurement |
| Event-loop delay | Server | How late the server's event loop ran. While it is late, nothing is relayed. About 1 ms is the granularity of the timer that measures it. |
| Latency p50 / p99 | Generator | From the moment a simulated player sends a message until another one has received it: half of the messages took less than p50, 99 in 100 less than p99 |
| Not delivered | Generator | Messages a receiver should have got and did not, found from gaps in the numbers each sender gives its messages |
| Frames, bytes out | Server | WebSocket frames, and bytes on the wire including the WebSocket framing |

The send time travels inside `data`, which the server never reads, so the latency is measured
by one clock, the generator's. It contains the server's work, two trips through the kernel's
network stack on one machine, and the generator's own reaction time, and none of a real
network. Read it as an upper bound of what the server adds.

Three kinds of latency appear:

- **ping**: a `ping` frame until its `pong`. Every simulated player sends one every 10 seconds,
  in every profile. It shows how long a frame waits for the server's attention, whatever else
  the server is doing.
- **chat, input, snapshot, saved**: a `msg` from sender to receiver.
- **op**: an op for the room's log from its sender to every member, the sender included. The
  server numbers it and queues it for the disk in between.
- **presence**: a presence value from sender to receiver. The server passes presence on in
  batches, 20 a second, so a value waits up to 50 ms for the next batch by design: a median
  near 25 ms and a p99 near 50 ms are the batching, not load.

### The yardsticks

- **Target** for one room of 20: under 25 % CPU, and under 10 ms of p99 latency for everything
  but presence.
- **Limit** of a profile: the load at which CPU passes 80 %, or p99 latency passes 50 ms
  (100 ms for presence: one batch interval more), or the server drops a connection or sends an
  error.

### Why these numbers are not a VPS's numbers

- **The CPU is faster than a small VPS's.** This desktop CPU runs at up to 4.4 GHz, and its one
  "CPU" is a full core's worth of time. A shared vCPU gives less. Expect a VPS to carry fewer
  players than the limits here, by a factor that only a measurement on that VPS can give.
- **CPU shares at light load read high.** The CPU column does not grow in proportion to the
  load: 1 room costs more than a twentieth of 20 rooms. Two things are behind that, and these
  measurements do not tell them apart. The machine's power saving slows an almost idle core
  down (to 800 MHz, from 4.4 GHz), so the same work takes more CPU *time*. And a server with
  little to do is woken once for every frame, while a busy one handles several per wake-up.
- **A VPS's memory is not all the server's.** The 512 MB here are the container's. On a rented
  machine the system and Docker take their share first. A DigitalOcean droplet with 1 GB, made
  from its Docker image, showed 45 % of its memory in use with the server, Caddy and a few
  players (2026-10-10, from DigitalOcean's graph). `docker stats` gave the server 40 MB of
  that and Caddy 19 MB, which is another measure than the RSS of the tables here. A 512 MB
  machine has not been tried.
- **There is no network.** No loss, no distance, no bandwidth cap. `npm run lag` is the tool
  for how a game feels on a bad connection; it is not part of these measurements.
- **One CPU of time is not one core.** `--cpus=1` lets the server's helper threads (garbage
  collection) run beside its main thread and then pauses the container when the sum exceeds
  its share. On a real single core they take turns instead.

### Versions

| | |
|---|---|
| Date | 2026-10-09 |
| Code | The server as of 2026-10-09, with the stats endpoint, the settings for the limits per address, and `bench/`. The saved-ops profile was measured later the same day, once the server had the log and host handover. |
| Server | Node.js 24.21.0 (`node:24-alpine`), `ws` 8.22.0, Hono 4.13.13, `@hono/node-server` 2.1.4, `node:sqlite` on disk |
| Container | Docker 29.8.2, `--cpus=1 --memory=512m --memory-swap=512m` |
| Generator | Node.js 24.18.0, 4 threads, on the host, connecting to the container's bridge address |
| Machine | Intel Core i5-11400F (6 cores, 12 threads), 30 GB, Ubuntu 26.04, Linux 7.0.0. Docker keeps its data, the container's database with it, on an SSD attached over USB (ext4). |

The generator's own event loop ran at most 2.4 ms late (p99) in any measurement below, so it
was not what was being measured.

## The profiles

| Profile | What every player does | The kind of game |
|---|---|---|
| `chat` | Sends one chat line (about 60 characters) every 10 s, to everyone, as the panel does | Any: the panel's chat |
| `presence` | Sets its presence 10 times a second: a position of about 60 bytes of JSON | Walking or driving one world together |
| `snapshots` | The host sends a 4 KB binary message to the others 15 times a second. Every guest sends about 40 bytes of JSON to the host 20 times a second. Both are `volatile`. | A world that the host runs and sends everybody whole |
| `ops` | Adds 2 ops a second to the room's log, about 70 bytes of JSON each. The host replaces the log by a 16 KB snapshot every 1,000 ops. | A world its players build |
| `mixed` | `presence` and `chat` together; every player saves a value (`retain: 'player'`) once a minute and the host a room value; every 30 s one member leaves and comes back as a new member; every 5 minutes one loses its connection and resumes | The soak: an evening of walking and talking that never ends |
| `idle` | Nothing but the ping every 10 s | None: memory per connection |
| `shooter` | Presence 20 times a second; shots as bytes about 7 times a second; 3 log ops a second; the host's report 10 times a second | A shooter whose marks are saved, as one was measured with three players firing |
| `views` | Each guest sends 20 bytes to the host 20 times a second; the host sends each guest a 500-byte part of one message 12.5 times a second, and a 37 KB save in two parts every 5 s | A world too big to send round, of which each guest is sent its part, as one was measured with eight players |

What games send, as measured in the browser tests, taught a few things about these numbers:

- **A player gets fewer frames than the others send together**, because the server passes presence on in batches,
  20 a second: three others moving at 15 a second arrive as about 19 frames a second, not 45.
- **Presence carries its time** since 2026-10-13, after the tables here were measured: about 19 bytes more for each
  value sent, and 14 for each value passed on (see [protocol.md](protocol.md#presence)).
- **A player may send 90 frames a second** by default. A walk or a drive uses a quarter of that or less, a shooter a
  third.
- **`sendEach` keeps a host under that limit.** A view for each of seven guests, 12.5 times a second, would be 87.5
  frames a second. In one message for all of them it is 12.5, and a guest more costs bytes, not frames.
- **A host's report of its units**, as bytes, is 16 to 24 bytes a unit: 80 units ten times a second are 13 to 19 KB
  a second to each guest, a small `snapshots` room.
- **A game that saves all through a match** writes to the room's log ten times a second for a room of three, a
  quarter of the `ops` room of 20, which met the database's pause about twice a minute ([What gives
  first](#what-gives-first), item 4). The browser tests' server keeps its database in memory, so they cannot show
  that pause; on a disk, a few such rooms would meet it now and then.

## One room

One room, at five sizes, each measured for 60 s after 20 s of warm-up. 64 is the largest room
the server allows. Nothing was dropped and no error was sent in any of these.

**Chat**

| Members | CPU | Memory (RSS) | chat p50 / p99, ms | ping p50 / p99, ms | Bytes out |
|---|---|---|---|---|---|
| 8 | 0.9 % | 95 MB | 1.24 / 2.27 | 0.87 / 1.28 | 1 KB/s |
| 16 | 1.2 % | 94 MB | 1.30 / 2.73 | 0.84 / 1.07 | 5 KB/s |
| **20** | **1.2 %** | 93 MB | 1.25 / **2.69** | 0.80 / 1.25 | 7 KB/s |
| 32 | 1.5 % | 94 MB | 1.32 / 2.93 | 0.63 / 1.50 | 18 KB/s |
| 64 | 2.5 % | 96 MB | 1.43 / 4.21 | 0.57 / 2.05 | 72 KB/s |

**Presence**

| Members | CPU | Memory (RSS) | presence p50 / p99, ms | ping p50 / p99, ms | Bytes out |
|---|---|---|---|---|---|
| 8 | 3.5 % | 96 MB | 25.6 / 50.6 | 0.54 / 1.18 | 38 KB/s |
| 16 | 5.6 % | 96 MB | 25.0 / 50.6 | 0.51 / 0.96 | 153 KB/s |
| **20** | **5.7 %** | 96 MB | 25.1 / 50.9 | 0.47 / **0.81** | 241 KB/s |
| 32 | 9.0 % | 98 MB | 26.7 / 51.5 | 0.45 / 1.85 | 620 KB/s |
| 64 | 16.0 % | 101 MB | 28.9 / 55.7 | 0.45 / 5.87 | 2.44 MB/s |

- Presence arrives 25 ms after it was sent in the median and 51 ms at p99. That is the batching
  (a value waits 0 to 50 ms for the next batch) plus about 1 ms.
- No value was lost: at 10 values a second and 20 batches a second, every value gets a batch.
- Bytes grow with the square of the room size: every player's position goes to every other
  player.

**Host snapshots**

| Members | CPU | Memory (RSS) | snapshot p50 / p99, ms | input p50 / p99, ms | ping p50 / p99, ms | Bytes out |
|---|---|---|---|---|---|---|
| 8 | 6.7 % | 96 MB | 0.95 / 1.42 | 0.54 / 0.78 | 0.50 / 0.86 | 441 KB/s |
| 16 | 10.6 % | 96 MB | 0.98 / 1.83 | 0.51 / 1.16 | 0.47 / 0.64 | 944 KB/s |
| **20** | **11.3 %** | 96 MB | 1.02 / **1.77** | 0.47 / 0.80 | 0.44 / 0.96 | 1.17 MB/s |
| 32 | 15.4 % | 97 MB | 1.22 / 2.61 | 0.44 / 1.87 | 0.41 / 1.66 | 1.91 MB/s |
| 64 | 22.1 % | 100 MB | 1.44 / 4.21 | 0.37 / 2.92 | 0.34 / 1.67 | 3.89 MB/s |

No snapshot and no input was dropped: no receiver ever fell behind.

**Saved ops**

| Members | CPU | Memory (RSS) | op p50 / p99, ms | ping p50 / p99, ms | Longest event-loop delay | Ops saved | Bytes out |
|---|---|---|---|---|---|---|---|
| 8 | 2.4 % | 96 MB | 1.01 / 1.63 | 0.64 / 0.92 | 2.9 ms | 16 /s | 17 KB/s |
| 16 | 2.8 % | 96 MB | 0.52 / 1.64 | 0.25 / 0.77 | 16 ms | 32 /s | 68 KB/s |
| **20** | **5.1 %** | 96 MB | 1.03 / **1.84** | 0.60 / 0.90 | 19 ms | 40 /s | 106 KB/s |
| 32 | 8.7 % | 101 MB | 1.14 / 2.11 | 0.54 / 1.42 | 29 ms | 64 /s | 271 KB/s |
| 64 | 24.5 % | 105 MB | 1.75 / 5.25 | 0.53 / 4.06 | 65 ms | 126 /s | 1.06 MB/s |

- Every op reached every member, in order: none was missing in any of these, and no error was
  sent.
- An op takes as long as a chat line: the server numbers it, sends it on, and writes it to disk
  a quarter of a second later, together with the room's other new ops.
- The longest event-loop delay is the one column that differs from the profiles above, where
  it stayed under 4 ms. About twice a minute the database syncs to disk, and the server waits
  for it. It does not show in the p99. See item 4 of [What gives first](#what-gives-first).
- At 64 members the host saves its 16 KB snapshot every 8 s; at 20, every 25 s.

**Against the target.** All four profiles meet it at 20 members, and still meet it at 64. The
median latency of about half a millisecond is mostly two idle programs waking each other up: it
*falls* when the server gets busier (see the next tables).

## Limits

Rooms of 20 were added until the limit: doubled until a size was over it, then narrowed down to
within a tenth. Each size was measured for 20 s, 5 s after its rooms had filled. The rows for
one room differ a little from the tables above: this measurement is shorter and starts sooner.

**Chat: within the limit at 256 rooms (5,120 players), over it at 272**

| Rooms | Players | CPU | Memory (RSS) | Event-loop delay p99 / max, ms | chat p50 / p99, ms | ping p50 / p99, ms | Bytes out | Limit |
|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 2 % | 95 MB | 1.44 / 3.89 | 1.58 / 3.96 | 0.87 / 1.09 | 7 KB/s | within |
| 2 | 40 | 2 % | 95 MB | 1.62 / 4.03 | 1.42 / 2.90 | 0.80 / 0.97 | 14 KB/s | within |
| 4 | 80 | 3 % | 96 MB | 1.01 / 5.13 | 1.29 / 3.02 | 0.72 / 1.12 | 29 KB/s | within |
| 8 | 160 | 3 % | 97 MB | 0.95 / 9.12 | 1.08 / 2.12 | 0.63 / 1.09 | 57 KB/s | within |
| 16 | 320 | 7 % | 98 MB | 1.24 / 25.8 | 1.12 / 2.47 | 0.62 / 1.80 | 115 KB/s | within |
| 32 | 640 | 11 % | 104 MB | 1.36 / 27.9 | 0.98 / 2.50 | 0.57 / 1.69 | 230 KB/s | within |
| 64 | 1,280 | 18 % | 110 MB | 1.40 / 41.9 | 0.92 / 2.50 | 0.53 / 2.21 | 461 KB/s | within |
| 128 | 2,560 | 32 % | 116 MB | 1.55 / 62.4 | 0.90 / 7.63 | 0.49 / 7.62 | 919 KB/s | within |
| 256 | 5,120 | 39 % | 131 MB | 1.26 / 122 | 0.57 / 48.8 | 0.30 / 47.3 | 1.79 MB/s | within |
| 272 | 5,440 | 42 % | 171 MB | 1.45 / 164 | 0.58 / 66.8 | 0.31 / 66.9 | 1.92 MB/s | over |
| 287 | 5,740 | 35 % | 171 MB | 1.36 / 168 | 0.36 / 71.6 | 0.20 / 70.7 | 2.02 MB/s | over |
| 317 | 6,340 | 36 % | 173 MB | 1.35 / 174 | 0.36 / 83.5 | 0.19 / 87.5 | 2.24 MB/s | over |
| 378 | 7,560 | 33 % | 173 MB | 1.08 / 197 | 0.24 / 106 | 0.13 / 104 | 2.67 MB/s | over |
| 500 | 10,000 | 36 % | 172 MB | 1.04 / 477 | 0.23 / 192 | 0.12 / 191 | 3.52 MB/s | over |

- Chat never comes near the CPU limit. What passes 50 ms is the p99, and the cause is in the
  "max" column: every 5 s the server stops for as long as it takes to ping every connection
  and tell every room its round-trip times. See [What gives first](#what-gives-first).
- The search went to 500 rooms and came back down. A server does not return memory it once
  took, so the rows from 272 to 378 show the memory of 10,000 players: 172 MB.

**Presence: within the limit at 104 rooms (2,080 players), over it at 112**

| Rooms | Players | CPU | Memory (RSS) | Event-loop delay p99 / max, ms | presence p50 / p99, ms | ping p50 / p99, ms | Bytes out | Limit |
|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 8 % | 95 MB | 1.28 / 2.01 | 25.6 / 51.0 | 0.53 / 1.58 | 242 KB/s | within |
| 2 | 40 | 12 % | 96 MB | 1.90 / 3.42 | 27.9 / 51.3 | 0.50 / 2.06 | 489 KB/s | within |
| 4 | 80 | 18 % | 97 MB | 3.70 / 6.75 | 27.3 / 51.5 | 0.46 / 4.32 | 979 KB/s | within |
| 8 | 160 | 25 % | 105 MB | 8.38 / 11.2 | 28.2 / 52.1 | 0.37 / 6.01 | 1.90 MB/s | within |
| 16 | 320 | 18 % | 102 MB | 9.50 / 15.1 | 27.0 / 53.0 | 0.08 / 5.94 | 3.81 MB/s | within |
| 32 | 640 | 25 % | 104 MB | 8.25 / 14.2 | 29.4 / 51.9 | 0.07 / 7.23 | 7.63 MB/s | within |
| 64 | 1,280 | 46 % | 112 MB | 14.2 / 36.8 | 31.8 / 54.6 | 0.09 / 12.8 | 15.26 MB/s | within |
| 96 | 1,920 | 73 % | 125 MB | 29.2 / 66.3 | 36.7 / 62.9 | 0.94 / 23.7 | 23.13 MB/s | within |
| 104 | 2,080 | 78 % | 126 MB | 35.0 / 88.0 | 37.7 / 69.4 | 2.94 / 29.7 | 25.32 MB/s | within |
| 112 | 2,240 | 87 % | 126 MB | 54.6 / 67.3 | 40.4 / 85.9 | 7.90 / 48.0 | 27.00 MB/s | over |
| 128 | 2,560 | 95 % | 126 MB | 79.7 / 167 | 45.0 / 111 | 12.8 / 60.6 | 30.24 MB/s | over |

- CPU is not proportional to the load at the light end (16 rooms cost less than 8); see "CPU
  shares at light load read high" under "Why these numbers are not a VPS's numbers". From 32
  rooms up, a room costs about 0.7 % of the CPU.
- The ping p99 rises with the number of rooms although pings are tiny. All rooms' presence
  goes out in the same batch, 20 times a second, and whatever arrives meanwhile waits for it.
- From 104 rooms on, a few presence values in ten thousand are replaced by a newer one before
  they go out (0.02 %; 0.7 % at 128 rooms). That is what presence is meant to do when the
  server runs late.

**Host snapshots: within the limit at 56 rooms (1,120 players), over it at 60**

| Rooms | Players | CPU | Memory (RSS) | Event-loop delay p99 / max, ms | snapshot p50 / p99, ms | input p50 / p99, ms | ping p50 / p99, ms | Bytes out | Limit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 10 % | 96 MB | 0.90 / 2.57 | 0.93 / 2.36 | 0.44 / 1.43 | 0.44 / 2.82 | 1.17 MB/s | within |
| 2 | 40 | 11 % | 97 MB | 0.97 / 1.55 | 0.37 / 1.92 | 0.15 / 0.91 | 0.29 / 1.16 | 2.34 MB/s | within |
| 4 | 80 | 12 % | 98 MB | 0.92 / 2.21 | 0.25 / 1.71 | 0.09 / 0.70 | 0.10 / 0.58 | 4.67 MB/s | within |
| 8 | 160 | 12 % | 103 MB | 0.91 / 1.54 | 0.19 / 0.48 | 0.05 / 0.30 | 0.05 / 0.22 | 9.34 MB/s | within |
| 16 | 320 | 23 % | 101 MB | 0.81 / 8.96 | 0.20 / 0.70 | 0.06 / 0.48 | 0.06 / 0.48 | 18.68 MB/s | within |
| 32 | 640 | 44 % | 105 MB | 0.82 / 19.5 | 0.24 / 1.05 | 0.10 / 0.87 | 0.09 / 0.86 | 37.37 MB/s | within |
| 48 | 960 | 65 % | 108 MB | 0.80 / 39.9 | 0.28 / 3.01 | 0.17 / 2.69 | 0.13 / 1.94 | 56.07 MB/s | within |
| 56 | 1,120 | 75 % | 109 MB | 1.72 / 55.4 | 0.35 / 9.57 | 0.24 / 8.12 | 0.19 / 7.29 | 65.41 MB/s | within |
| 60 | 1,200 | 85 % | 109 MB | 8.38 / 156 | 0.50 / 28.8 | 0.40 / 28.2 | 0.33 / 22.6 | 70.09 MB/s | over |
| 64 | 1,280 | 85 % | 108 MB | 8.45 / 67.3 | 0.47 / 18.1 | 0.38 / 17.8 | 0.31 / 17.3 | 74.75 MB/s | over |

- From 16 rooms up, a room costs about 1.3 % of the CPU.
- Latency stays under a millisecond until the CPU is two thirds used: snapshots are relayed at
  once, and nothing is batched on a timer.
- Nothing was dropped at any size, although both kinds of message are `volatile`. On one
  machine no receiver falls behind; on a real network some will.

**Saved ops: within the limit at 104 rooms (2,080 players), over it at 112**

| Rooms | Players | CPU | Memory (RSS) | Event-loop delay p99 / max, ms | op p50 / p99, ms | ping p50 / p99, ms | Ops saved | Bytes out | Limit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 7 % | 96 MB | 1.85 / 2.81 | 1.14 / 2.34 | 0.63 / 1.11 | 40 /s | 104 KB/s | within |
| 2 | 40 | 9 % | 98 MB | 1.97 / 28.0 | 1.06 / 2.39 | 0.58 / 1.52 | 80 /s | 208 KB/s | within |
| 4 | 80 | 16 % | 100 MB | 1.77 / 20.8 | 1.05 / 2.47 | 0.54 / 1.66 | 159 /s | 417 KB/s | within |
| 8 | 160 | 29 % | 106 MB | 1.63 / 40.4 | 0.99 / 4.55 | 0.49 / 3.63 | 319 /s | 835 KB/s | within |
| 16 | 320 | 41 % | 106 MB | 2.86 / 54.5 | 0.82 / 13.7 | 0.39 / 8.07 | 639 /s | 1.64 MB/s | within |
| 32 | 640 | 43 % | 111 MB | 9.38 / 44.0 | 0.42 / 24.4 | 0.19 / 24.6 | 1,275 /s | 3.28 MB/s | within |
| 64 | 1,280 | 50 % | 123 MB | 29.6 / 59.2 | 0.29 / 33.7 | 0.10 / 32.6 | 2,550 /s | 6.57 MB/s | within |
| 96 | 1,920 | 70 % | 150 MB | 63.7 / 93.7 | 0.53 / 47.1 | 0.35 / 46.0 | 3,834 /s | 9.91 MB/s | within |
| 104 | 2,080 | 76 % | 149 MB | 65.2 / 89.0 | 0.63 / 44.7 | 0.45 / 45.1 | 4,150 /s | 10.77 MB/s | within |
| 112 | 2,240 | 83 % | 149 MB | 81.2 / 193 | 3.83 / 95.3 | 3.63 / 89.7 | 4,449 /s | 11.58 MB/s | over |
| 128 | 2,560 | 93 % | 150 MB | 164 / 232 | 44.3 / 182 | 39.1 / 177 | 5,113 /s | 13.13 MB/s | over |

- The p99 climbs long before the CPU is used up: 14 ms at 16 rooms, 34 ms at 64. A ping waits
  as long as an op does, so it is not the ops that are slow: the whole server stops, for the
  20 to 60 ms of the "max" column, each time the database syncs to disk. The more is written,
  the more often that happens. See item 4 of [What gives first](#what-gives-first).
- From 64 rooms up, a room costs about 0.7 % of the CPU, most of it for sending each op to 20
  members. Writing the ops is a small part: with the database on a memory disk, the server
  spent under 2 % of its busy time in the database at 64 rooms.
- **The first measurement gave 76 rooms.** The server then wrote each room's new ops as a
  write of its own, four times a second. Past 76 rooms it fell behind all at once, at 63 % CPU
  (`bench/results/2026-10-09-ops-ramp-one-write-per-room.json`). It now writes the new ops of
  all rooms in one go, and the table above is that.

## Idle players

1,000 members who only keep their connection, then 2,000, in rooms of 20, each measured for
60 s.

| | Memory (RSS) | CPU | ping p99 |
|---|---|---|---|
| Nobody connected | 93 MB | | |
| 1,000 idle players | 110 MB | 4.0 % | 1.1 ms |
| 2,000 idle players | 116 MB | 7.1 % | 9.0 ms |

- **Memory per idle player: about 6 KB.** The first thousand cost 17 KB each, which includes
  what the server grows by once, the first time it does anything; the second thousand cost
  6 KB each. The kernel's socket buffers come on top and are not in these numbers.
- **An idle player is not free of CPU**: about 0.004 % each, for the heartbeat every 5 s, the
  round-trip times sent to the room every 5 s, and the client's ping every 10 s.
- **Measured before a page in front had to say something every second.** Since member states
  (`docs/protocol.md`, "Members and host"), a page in front that has sent nothing for half a
  second sends a 26-byte frame, once a second. The load generator does the same now. These two
  rows have not been measured again with it.

## Bandwidth

What the server sends for one room, from the tables above. A $4 DigitalOcean droplet includes
500 GB of outbound traffic a month.

| One room | Per second | Per hour | Hours of play in 500 GB |
|---|---|---|---|
| Chat, 20 players | 7 KB | 0.03 GB | 20,000 |
| Presence, 8 players | 38 KB | 0.13 GB | 3,800 |
| Presence, 20 players | 241 KB | 0.83 GB | 600 |
| Presence, 64 players | 2.44 MB | 8.6 GB | 58 |
| Host snapshots of 4 KB, 8 players | 441 KB | 1.5 GB | 330 |
| Host snapshots of 4 KB, 20 players | 1.17 MB | 4.1 GB | 120 |
| Host snapshots of 4 KB, 64 players | 3.89 MB | 13.7 GB | 37 |
| Saved ops, 8 players | 17 KB | 0.06 GB | 8,600 |
| Saved ops, 20 players | 106 KB | 0.36 GB | 1,400 |

- In powers of 1000, presence at 20 players is 0.9 GB an hour, and snapshots 4.4.
- **Bandwidth is the limit that matters.** At the CPU limit of the presence profile the server
  sends 25 MB every second: the month's 500 GB in under 6 hours. For snapshots it is 65 MB a
  second, and a little over 2 hours.
- Each player of the presence room downloads 12 KB/s; each guest of the snapshot room 62 KB/s
  (0.5 Mbit/s). A game that sends snapshots should send what changed, not the whole world.

## Where the CPU time goes, and the choice of `ws`

Is `ws` enough, or should the socket layer move to uWebSockets.js or to Bun? For this the
server was profiled under three loads (Node's
`--cpu-prof`, with the server as a plain process on this machine; the shares are what
matter, not the totals):

| Share of the server's busy time | Presence, 64 rooms | Snapshots, 32 rooms | Chat, 128 rooms |
|---|---|---|---|
| `writev`: the kernel taking one frame for one socket | 44 % | 41 % | 56 % |
| Node's own stream and socket code around it | 18 % | 19 % | 18 % |
| The hub: room rules, routing, building presence batches | 14 % | 10 % | 6 % |
| The `ws` library | 6 % | 9 % | 5 % |
| Validating incoming frames, JSON parsing included | 4 % | 8 % | 2 % |
| Other native code: reading sockets, waiting for events | 10 % | 11 % | 8 % |
| The rest of the server, garbage collection | 4 % | 3 % | 4 % |

**Decision: `ws` stays.**

- **At the size the project is for there is nothing to win.** One room of 20 uses 1 to 11 % of
  one CPU and adds about a millisecond.
- **Where the server does run out, the socket library is not what it runs out of.** Half of
  the time is the kernel's work for each frame sent: one frame, one receiver, one write.
  Another library makes the same writes. What it could shrink is the quarter spent in `ws` and
  in Node's streams.
- **Switching has a price.** uWebSockets.js installs from GitHub instead of npm and brings its
  own HTTP server, so the portal and the REST API would move too. Bun means another runtime
  in the image and another SQLite binding.

## What gives first

In the order the measurements met them. None of these matters at 20 players; they are where
to look if a server ever has to carry hundreds.

1. **Work done for everyone at the same instant.** Two timers do something for every
   connection in one go, and while they do, nothing else is relayed.
   - *The heartbeat*, every 5 s: a WebSocket ping to every connection and the round-trip times
     to every room. With 5,000 connections the server stops for 120 ms; with 10,000, for close
     to half a second. This alone sets the chat limit: in a separate run, 4,480 players who
     said nothing at all gave a ping p99 of 67 ms at 16 % CPU
     (`bench/results/2026-10-09-idle-4480.json`).
   - *Presence batches*, 20 times a second: all rooms go out in the same batch. With 64 rooms
     of walking players that is a 14 ms stop, 20 times a second, and a chat line or an input
     that arrives meanwhile waits for it.

   Spreading either over its interval (a slice of the connections, or of the rooms, at a time)
   would shorten the stops without changing what is sent. Not done: nothing near the size p3p2
   is for needs it.
2. **One kernel write per frame per receiver.** See the profile above. A game helps most by
   sending less: presence instead of messages for positions, changes instead of whole
   snapshots.
3. **Bandwidth**, well before the CPU limit, as shown above.
4. **The database's syncs to disk**, for games that save a lot. The server has one thread, and
   the database runs in it.
   - *An ordinary write is cheap.* The new ops of 64 rooms of 20, 640 rows, take 2 to 8 ms to
     write, four times a second.
   - *A sync is not.* SQLite collects writes in a file beside the database (the write-ahead
     log) and moves them into the database when that file has grown to 4 MB. That move ends
     with a sync to disk, and nothing is relayed while it lasts. On this machine's disk, an SSD
     attached over USB, it takes about 35 ms.
   - *How this was told apart*: the same writes on the same disk, outside the server. Of 120
     writes of 640 rows, 26 took over 20 ms, most of them about 35. With the move into the
     database switched off, none took more than 4 ms; on a memory disk, none more than 3 ms.
   - *How often*: with one room of 20 saving 40 ops a second, about twice a minute (20 times
     in ten minutes' worth of writes), which no p99 shows. With 64 rooms, about once a second.

   Doing that move from a second thread would take the pause out of the server's own thread.
   It was tried, measured, and taken out again: see
   [A room that saves beside one that relays](#a-room-that-saves-beside-one-that-relays). On one
   core it made the event loop's p99 worse, and the pauses were under 50 ms without it.

## A room that saves beside one that relays

Does a game that saves all the time slow down a game that only relays, on the same server? The
fix for the database's pause (item 4 above) would be worth its cost if a shooter's room got
pauses over 50 ms beside such rooms that it did not get alone.

**The run.** One server, its database on this machine's disk. A shooter's room of 8 players (the
`shooter` profile, a shooter whose marks are saved: presence 20 times a second, shots, the host's report,
and 3 log ops a second from each player, 27 saved rows a second). Beside it, 20 rooms of 20 players
adding 2 ops a second each (the `ops` profile): 800 saved rows a second, 17,000 frames a second
out. Two minutes each.

**Pinned to one core** (`--cpuset-cpus`, which is what a VPS with one vCPU is like):

| The shooter's room | Event loop late, p99 / max | Shots, p99 / max | The host's report, p99 / max | Log ops, p99 / max |
|---|---|---|---|---|
| Alone | 1.0 / 21 ms | 1.2 / 7.8 ms | 1.2 / 20 ms | 1.2 / 16 ms |
| Beside 400 players who save | 2.2 / 39 ms | 9.6 / 44 ms | 3.6 / 34 ms | 7.0 / 35 ms |
| The same, with the database's move done by a second thread | 4.0 / 53 ms | 11 / 31 ms | 3.4 / 10 ms | 13 / 35 ms |

- **The fix is not worth it**: beside the rooms that save, the shooter's room got pauses of up to
  44 ms in what it was sent, under the 50 ms of that rule.
- **A second thread does not help on one core.** Tried as the last resort: a thread with
  its own connection moved the log into the database once a second. The worst delivery fell, the
  event loop's p99 doubled (the thread's work shares the one core), and the log's side file grew
  to 32 MB, because under steady writes it was never reset. Taken out again.

**What the quota did.** The same runs with a CPU quota instead (`--cpus=1`, the way the rest of
this page is measured) gave pauses of 123 ms beside the rooms that save, and of 69 ms with the
second thread. That was the quota and not the disk: the container was stopped six times for about
100 ms each (`nr_throttled` in its `cpu.stat`), because Node's own threads (the garbage collector,
the second thread) can run at the same moment on a machine with twelve cores and use up the
quota's share early. With the database in memory, under the same quota, the worst pause was 10 ms.
**On a quota, latencies of more than a few tens of milliseconds on this page may be the quota's.**

The results are in `bench/results/2026-10-11-mixed-*.json`.

## Profiles shaped by games

Two profiles in `bench/` take their shape from what two kinds of game were measured to send in the
browser tests. One room of 8, `--cpus=1`, a minute:

| Profile | CPU | Event loop late, p99 / max | Latency p50 / p99 | Sent by the server | Not delivered |
|---|---|---|---|---|---|
| `shooter` | 4.5 % | 0.9 / 19.7 ms | shots 0.22 / 1.04 ms, the host's report 0.20 / 1.02, log ops 0.22 / 1.13 | 171 KB/s | presence values replaced by newer ones only |
| `views` | 3.3 % | 0.9 / 1.6 ms | views 0.24 / 1.26 ms, intents 0.14 / 0.70 | 110 KB/s | nothing |

A room of 8 of either is a small part of a CPU, like the profiles above.

## Soak

A day in one room of 20 with the `mixed` profile: everyone walks and chats, values are saved
every minute, a member leaves and comes back every 30 s, a connection is cut and resumes every
5 minutes. The target: memory (RSS) at the end within 10 % of memory at the start.

**Done: +1.4 %.** 2026-10-11 22:11 to 2026-10-12 22:11 (UTC+11), 1,438 samples of a minute each,
in `bench/results/soak-2026-10-11.jsonl`; what the command printed is in `soak-2026-10-11.log`.
The server's code was as of 2026-10-11.

| | |
|---|---|
| Memory (RSS), start → end | 99.2 → 100.6 MB (+1.4 %); peak 103.1 MB |
| Memory (RSS), median of each 4 hours | 99.3, 99.9, 100.2, 100.5, 100.5, 100.5 MB |
| JS heap, median of each 4 hours | 14.1, 14.0, 14.1, 14.4, 14.2, 14.2 MB |
| CPU | 5.9 % in the median minute, 7.2 % in the highest |
| Event-loop delay p99 | 1.93 ms in the worst minute |
| Latency p99, median minute / worst minute | ping 0.97 / 2.66 ms; presence 50.9 / 51.7 ms; chat 1.83 / 3.95 ms; saved values 2.24 / 57.8 ms |
| Not delivered | 56 of 327 million presence updates (replaced, not lost: below); none of 3.4 million chat messages and 603,000 saved values |
| Connections dropped by the server, errors | 0, none |

By the profile's schedule, about 2,880 members were replaced and 288 connections cut.

- **Memory levels off.** RSS rose 1.2 MB in the first 12 hours, while the JS heap stayed level,
  and not at all after: the last three 4-hour medians are the same. A straight line through all
  readings gives 0.05 MB an hour. The first run's 0.3 MB an hour (below) looks like the start
  of that rise.
- **The 56 not delivered were replaced by newer ones.** Presence keeps only each member's latest
  value and goes out 20 times a second; each member sends one 10 times a second. In two minutes
  the server stopped for 54 and 61 ms, its two longest pauses (the next was 26 ms), and in each
  a member's update was replaced by its next before it went out. Every other member counts that
  as a gap, so one replaced update counts 18 or 19 times: 38 and 18 are two updates and one. The
  server's own counts of presence skipped and messages dropped stayed at 0.
- **Saved values were slow in 46 of the 1,438 minutes**: a p99 of 10 to 58 ms, against 2.24 ms
  in the median minute, about the first run's share. In 31 of them the server's event loop was
  held up 10 to 54 ms in the same minute, which fits a sync to disk (item 4 of
  [What gives first](#what-gives-first)). In the other 15 it was not, and those were not looked
  into. What stopped the server for 61 ms is not known either: no save was slow in that minute.

### The first run

On 2026-10-09 a first run was stopped by hand after 4.8 of its 24 hours
(`bench/results/soak-2026-10-09.jsonl`): RSS 100.1 → 99.6 MB (−0.5 %) but rising 0.3 MB an hour
from the second hour, nothing undelivered, no errors, and saved values slow in 10 of the 290
minutes. The full run above shows that memory levels off; the slow saves are only partly
explained.

### Running it

```sh
npm run bench -- soak --hours 24
npm run bench -- soak-report bench/results/soak-<date>.jsonl   # at any time, finished or not
```

- It needs this machine awake and reasonably quiet for a day.
- A run started on the same date writes over that date's file: give it another `--out` to keep
  an earlier one.
- Ctrl-C stops it and removes its container, `p3p2-soak`. The file keeps what was
  measured until then. Started in the background instead, it is stopped with
  `pkill -f 'bench/src/main.ts soak'` and then `docker rm -f -v p3p2-soak`.

How the summary measures growth: the first 1 % of the samples are warm-up, the next 4 % are
"the start" and the last 4 % "the end" (about an hour each, over a day), and it compares the
median RSS of the two. It also fits a straight line through all readings after the warm-up,
which tells a slow leak from a plateau. "Not delivered" counts every gap in a sender's numbers,
so a presence update replaced by a newer one before it went out counts too.

## Reproducing

Needs Docker and Node.js 24. The image is built from the working tree by the first command.

```sh
npm run bench -- all                 # the tables of "One room", "Limits" and "Idle players"; about 55 minutes
npm run bench -- sweep presence      # one of them: one room at 8, 16, 20, 32 and 64 members
npm run bench -- ramp presence       # rooms of 20, to the limit
npm run bench -- idle
npm run bench -- soak --hours 24     # one line a minute into bench/results/soak-<date>.jsonl
npm run bench -- soak-report bench/results/soak-2026-10-11.jsonl

# The CPU profiles: the server as a process here, with Node's profiler.
npm run bench -- run presence --rooms 64 --target local --profile-dir /tmp/profile
```

- The numbers of this document are in `bench/results/2026-10-09.json`, with the tables as the
  command printed them next to it. Those of the saved-ops profile, measured later with
  `sweep ops` and `ramp ops`, are in `bench/results/2026-10-09-ops-sweep.json` and
  `2026-10-09-ops-ramp.json`.
- `--target http://…` measures a server that is already running, with `BENCH_PASSWORD` and
  `BENCH_STATS_TOKEN` set to its owner password and its `P3P2_STATS_TOKEN`: a VPS, for
  instance, with the generator on a second machine. That server needs `P3P2_CONNECT_RATE` and
  `P3P2_API_RATE` raised.
- `--speed 2` doubles every rate of a profile. Above 2, presence is sent faster than the server
  batches it, and values are replaced before they go out.
