<!--
What Docker Hub shows for p3p2/p3p2. The short description (at most 100 characters) goes in its own field:

Multiplayer for static web games, through a small server of your own

The overview is everything below the line.
-->

---

# p3p2

Multiplayer for static web games, through a small server of your own.

This is the **p3p2 server**. Its owner logs in to a portal and creates *rooms*, each for one game. The server
relays messages between the players in a room and saves what the game asks it to keep. It never needs to know
what the messages mean. Games use it through the client library,
[`@p3p2/client`](https://www.npmjs.com/package/@p3p2/client).

One Node.js process with SQLite: one room of 20 players takes a few percent of a CPU, and the server 40 to 100 MB
of memory.

## Tags

| Tag | |
|---|---|
| `0.1.0` | One release, never changed |
| `0.1` | The newest 0.1 release, with its fixes |
| `latest` | The newest release |

Each is built for `linux/amd64` and `linux/arm64`, and carries the provenance of its build and an SBOM.

## On a VPS, with HTTPS

A game on an `https://` site can only talk to a server that has HTTPS too. The repository's
[`deploy/`](https://github.com/doublependu/p3p2/tree/main/deploy) puts Caddy in front of the server, which gets
and renews the certificate by itself:

```sh
git clone https://github.com/doublependu/p3p2 /opt/p3p2
cd /opt/p3p2/deploy
cp .env.example .env          # then set P3P2_DOMAIN in it to your name
docker compose up -d
docker compose logs p3p2      # prints the one-time setup link
```

The whole walk-through, with backups, updates and moving, is
[docs/self-host.md](https://github.com/doublependu/p3p2/blob/main/docs/self-host.md).

## Alone, over plain http on a LAN

```sh
docker run -d --name p3p2 -p 8080:8080 -v p3p2-data:/data \
  -e P3P2_PUBLIC_URL=http://<this machine's address>:8080 p3p2/p3p2:0.1
docker logs p3p2              # prints the one-time setup link
```

- **`/data`** holds the SQLite database: the owner's password, the rooms, and what they saved. Keep it in a
  volume.
- **Settings** are environment variables, `P3P2_…`, all optional: the
  [README's table](https://github.com/doublependu/p3p2#server-settings).
- **`/healthz`** answers `ok`, and the image's health check asks it.

## Licence and source

The server is under the [GNU Affero General Public License, version 3](https://github.com/doublependu/p3p2/blob/main/LICENSE),
and its source is at <https://github.com/doublependu/p3p2>. Every portal page links to it. Whoever runs a
changed server sets `P3P2_SOURCE_URL` to the changed source. The client library is under the MIT License.
