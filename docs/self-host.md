# Hosting a server

How to put a p3p2 server on a rented machine, with HTTPS, so that friends anywhere can
join your rooms. It takes a VPS and a few commands.

A game on an `https://` site can only talk to a server that has HTTPS too. That is what this
setup is for: [Caddy](https://caddyserver.com) sits in front of the server, gets a certificate
from Let's Encrypt, and renews it by itself.

```
players ── https, wss ──▶ Caddy :443 ──▶ the server :8080 ──▶ SQLite, in a Docker volume
```

## What you need

- **A VPS with Docker**, and its Compose plugin (`docker compose version` answers). One vCPU
  and 1 GB of memory is what this has run on. With a few players, that machine's memory was
  45 % in use. `docker stats` showed the server at 40 MB and Caddy at 19 MB of it; the rest is
  the system and Docker. A 512 MB machine has not been tried.
  [`performance.md`](performance.md) has the numbers.
- **Ports 80 and 443 reachable** from the internet (TCP, and UDP 443 for HTTP/3).
- **A domain name** you can add a record to. Without one, see
  [Without a domain name](#without-a-domain-name).

Rent it close to the players. Everything they send each other goes through this machine, so
its distance is their lag.

These steps have run as they are on a DigitalOcean droplet made from its Docker image
(Marketplace → Docker). Its firewall needed no change.

## How big a machine

The smallest one there is. One CPU with 1 GB of memory is far more than friends playing need: one room of 20
players took between 1 and 11 % of a CPU in the measurements, and a few hundred such rooms fit before the CPU
runs out ([performance.md](performance.md)). What a VPS runs out of first is the **data it may send**, a monthly
allowance. What one room costs, from the profiles in [performance.md](performance.md#bandwidth):

| A room of | Out to the players | In an hour |
|---|---|---|
| 20 chatting | 7 KB/s | 25 MB |
| 8 walking, positions 10 times a second | 38 KB/s | 134 MB |
| 20 walking | 241 KB/s | 0.83 GB |
| 8 saving 2 ops a second each | 17 KB/s | 60 MB |
| 8 sent 4 KB by the host 15 times a second | 441 KB/s | 1.5 GB |

A machine with 1 TB a month sends a room of eight walking players for nearly eight thousand hours, and a room of
eight that the host sends 4 KB snapshots for about seven hundred. Beside the system's own memory, the server takes
40 to 100 MB, and Caddy about 20.

## 1. Point the name at the VPS

Add an `A` record for the name, say `p3p2.example.com`, with the VPS's IPv4 address.

- **On Cloudflare, set the record to "DNS only"** (the grey cloud). Through Cloudflare's proxy
  every player would seem to come from Cloudflare, and they would all share one allowance of
  connections.
- **Leave out the `AAAA` record** (IPv6). This setup has been tried over IPv4 only.
- **Do this first.** Caddy asks for the certificate when it starts, and Let's Encrypt stops
  answering for an hour after five failed tries for a name.

## 2. Put the code on the VPS

With git on the VPS, clone this repository into `/opt/p3p2`. Or copy a checkout from your
own machine, which needs only SSH and `rsync` on the VPS:

```sh
rsync -az --delete --filter=':- .gitignore' --exclude=.git --exclude=.env \
  ./ root@p3p2.example.com:/opt/p3p2/
```

That sends the checkout as it is, without what git ignores.
`--exclude=.env` keeps the copy from deleting the settings file of step 3 the next time you
run it.

## 3. Start it

On the VPS:

```sh
cd /opt/p3p2/deploy
cp .env.example .env          # then set P3P2_DOMAIN in it to your name
docker compose up -d --build
docker compose logs p3p2
```

The log ends with a link, `https://p3p2.example.com/setup?token=…`. Open it once and choose the
owner password. From then on `https://p3p2.example.com/` is the portal, where you log in and
create rooms.

`https://p3p2.example.com/healthz` answers `ok` once Caddy has the certificate, a moment after
the first start.

## 4. A room, and a game in it

1. In the portal, create a room. As the game URL give the address of the game, for instance
   `game.example.com`. The room only works from that site.
2. Copy the room URL, `https://p3p2.example.com/room/…`. It is the key to the room: whoever has
   it can host there.
3. Open the game, open its 👥 panel, paste the room URL, and press *Create a multiplayer game
   room for my friends*. Send them the link it shows, or let them scan the QR code.

## Settings

Every setting in the [README's table](../README.md#server-settings) can go into
`deploy/.env`, one `NAME=value` per line. Five are set for you and cannot be changed there:
`P3P2_PUBLIC_URL`, which is `https://` and your name, `P3P2_TRUST_PROXY`,
`P3P2_HOST`, `P3P2_PORT` and `P3P2_DATA_DIR`.

`docker compose up -d` applies a changed `.env`. It restarts the server; see the next section
for what players notice.

## Updating

Copy the new code as in step 2 (or `git pull`), then on the VPS:

```sh
cd /opt/p3p2/deploy && docker compose up -d --build
```

- **The server is gone for a few seconds.** Everyone who is playing is cut off, and their
  pages come back by themselves, into the same room.
- **What a room has saved is still there**: its saved values and its log are in the database.
  The recent chat is not.
- **Who hosts may change**: the first player back is the host.
- Each build leaves the image before it behind. `docker image prune -f` removes them.

## Backups

Everything the server knows is one SQLite database in the Docker volume
`p3p2_p3p2-data`: the owner's password, the rooms and their keys, the invites, and
what the rooms have saved. To copy it out, with the server stopped for a moment:

```sh
cd /opt/p3p2/deploy
docker compose stop p3p2
docker compose run --rm --no-deps --user root -v "$PWD:/backup" p3p2 \
  tar czf /backup/p3p2-data.tar.gz -C /data .
docker compose start p3p2
```

To bring it back on a new machine: steps 1 and 2, the `.env` of step 3, the backup copied into
`/opt/p3p2/deploy`, and then, **before** step 3's `docker compose up`:

```sh
docker compose run --rm --no-deps --user root -v "$PWD:/backup" p3p2 \
  tar xzf /backup/p3p2-data.tar.gz -C /data
```

It builds the image first if there is none yet. Then `docker compose up -d --build` as in step 3:
no setup link is printed, because the owner came back with the database, and the old password
logs in.

The other volume, `p3p2_caddy-data`, holds the certificate. Caddy gets a new one when it
is missing, so it needs no backup. Do not delete it without a reason either: Let's Encrypt
gives out only so many certificates for a name in a week.

## Moving to another machine

A backup, as above, on the old machine; on the new one, the backup brought back as above, and the name pointed
at the new address. The room URLs and invite links stay as they were,
because they carry the name, not the machine. Players who are in a room when the old machine stops come back by
themselves once the name points at the new one and their browsers learn it.

## What you can see of the players

As the one who runs the server, you can read everything that passes through it, and everything it saved: names,
chat, what the games send and save. Its log records joins and leaves (a player's id, a room, a time), not what was
sent. The players' IP addresses reach the server; it uses them for the rate limits, and writes one to its log only
for a join refused for a wrong key or invite. The
players see only the server's address, not each other's. [security.md](security.md) says what the room keys and
invites protect.

## Removing it all

- **A room's saved data**: **Clear saved data** on the room's page in the portal. Its log, its saved values and
  every player's saved values in it go.
- **A room**: **Delete room**. Its URL and its invite stop working.
- **Everything**: on the VPS, `cd /opt/p3p2/deploy && docker compose down -v` stops the server and Caddy and
  deletes both volumes, the database with them; `rm -rf /opt/p3p2` removes the code, and
  `docker image rm p3p2/p3p2 caddy:2` the two images. (Not `docker image prune -a`, unless p3p2 is all the
  machine runs: it removes every image that no running container uses.)

## Without a domain name

Let's Encrypt also gives certificates for a bare IP address. In `deploy/.env`:

```sh
P3P2_DOMAIN=203.0.113.7          # the VPS's public IPv4 address
P3P2_CADDYFILE=Caddyfile.ip
```

Room URLs and invite links then carry the address: `https://203.0.113.7/room/…`. These
certificates last six days and Caddy renews them every few days, so the server depends on
Let's Encrypt being reachable more than with a name. If the VPS gets another address, every
room URL and invite link changes with it.

This has not been tried on a public address.

## Trying it on your own machine first

The same setup runs on a machine at home, with a certificate that Caddy signs itself:

```sh
cd deploy
printf 'P3P2_DOMAIN=p3p2.localhost\nP3P2_CADDYFILE=Caddyfile.local\n' > .env
docker compose up -d --build
```

`https://p3p2.localhost/` then shows the portal, after the browser's warning about the
certificate. It needs ports 80 and 443 of the machine. It is for looking at the setup, not for
playing: other devices do not trust that certificate. To play on a home network, run the
server without Docker, over plain http, as the [README](../README.md#try-it-on-one-machine)
describes.

`docker compose down` stops it, and `docker compose down -v` also deletes its database.

## Behind a proxy you already have

The server's image runs alone as well: `docker build -f deploy/Dockerfile -t p3p2/p3p2 .`
and the `docker run` line at the top of [`deploy/Dockerfile`](../deploy/Dockerfile). The proxy
in front of it has to do three things:

- pass WebSocket upgrades on `/api/v1/ws`;
- pass the `Host` header unchanged: the portal checks its forms against it;
- put the visitor's address last in `X-Forwarded-For`. The server reads it there when
  `P3P2_TRUST_PROXY=1` is set.

Set `P3P2_PUBLIC_URL` to the address players use. And keep the proxy's access log off,
or out of reach: a room URL has the room's key in its path.

## When something is wrong

| What you see | Look at |
|---|---|
| The browser cannot connect, or warns about the certificate | `docker compose logs caddy`. Usually the name does not point at this machine yet, Cloudflare's proxy is on, or port 80 or 443 is closed. |
| No setup link in the log | It is printed on every start until an owner exists. `docker compose logs p3p2` shows the latest; an older link no longer works. |
| The game says the room "isn't set up for" its site | The room's game URL is another site than the one the game is on. On the room's page in the portal, add the site to *Sites that may use this room*. |
| Many players behind one router are told "Too many tries" | They share one address, and its allowance. Raise `P3P2_API_RATE` and `P3P2_CONNECT_RATE`. |
| The owner password is lost | Set `P3P2_OWNER_PASSWORD` in `.env` and run `docker compose up -d`. It replaces the password and logs every session out. |
