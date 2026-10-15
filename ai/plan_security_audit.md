# The security audit

Iteration 2 runs this. It audits `main` as it is when the audit starts, which is `0.1.0` (tag `v0.1.0`, commit
`6e3465b`) plus what came after: the server, the protocol, the client, the setup in `deploy/`, the workflows in
`.github/`, and what was published from them. It doesn't cover `bench/` and `e2e/`, which are test tools, or
`examples/`, except for what they teach games to do: games copy them.

The audit comes after the release. `0.1.0` is on npm and Docker Hub, and the repository is public, so what the
audit finds is about code that people can already run. "Public already" below says what that changes.

## How

- **For each area below**: read the files it names, list what an attacker controls there, and try it against a
  server on this machine. Nothing is tried on the internet. Reading what is published is fine: npm's and Docker
  Hub's metadata, and GitHub's settings through `gh api` (read only).
- **For each suspicion, write a test first**, in the test suite of the package it is about (`server/test/`,
  `client/test/`, `protocol/test/`, `e2e/`), so that it fails while the hole is there. Where no test can be
  written, give the exact steps.
- **Tools**, beside reading:
  - `npm audit --omit=dev` for the server's dependencies, and `npm audit` for the rest;
  - a scan of the published image, `p3p2/p3p2:0.1.0`, for each machine (Trivy, or Docker Scout);
  - `actionlint` and `zizmor` on `.github/workflows/`;
  - a secret scanner (gitleaks, or trufflehog) over the whole history.
- **Findings** go in `ai/findings_2.md`, written as in "A finding" below.

## Public already

A finding written down and pushed is a finding disclosed, to everyone, before servers and games have the fix.

- **`ai/findings_2.md` stays uncommitted** until every critical, high and medium finding in it is released or
  accepted. It is listed in `.git/info/exclude`, which is local and never committed, so `git add` skips it.
- **A critical, high or medium fix** is committed with its test, and stays on this machine until the release
  that carries it. Then the fixes and the release commit of `0.1.x` are pushed together, and tagged once CI is
  green. The fix is visible for as long as CI takes, and no longer. Until then, the commit message says what
  changed, not how to exploit what was there.
- **Low and info findings** are fixed in ordinary commits.
- **After the release**, a critical or high finding gets a GitHub security advisory (Security → Advisories), and
  `ai/findings_2.md` is committed.
- **A fix release is `0.1.x`.** `deploy/docker-compose.yml` pulls `0.1`, so operators get it with
  `docker compose pull`, and games get it with the next `npm update`. jsDelivr's `@0.1` follows within its cache
  time.

## What is worth protecting

| What | Where it is | Who holds it, and what it opens |
|---|---|---|
| The owner's password | `owner.password_hash` (scrypt) | The portal: every room |
| A portal session | Cookie `p1_session`; `portal_sessions.token_hash` (SHA-256) | The same as the password, for 30 days |
| The setup token | Printed in the server's log until an owner exists | Choosing the owner's password |
| A room key | `rooms.key`, in clear, because the portal shows room URLs; in the room URL and in the portal's addresses (`/room/<key>`) | Hosting, kicking, ending, renewing the invite |
| An invite code | `invites.code`; in the invite link | Joining one room, until it expires or is renewed |
| A player's secret | The browser's storage, on the game's origin; `players.secret_hash` | Being that player, and their saved values |
| The stats token | The environment | `/api/v1/stats` |
| What rooms saved | `retained`, `ops`, `snapshots` | Every member of the room reads all of it |
| The server running | CPU, memory, disk, the VPS's monthly data allowance | Everybody's games |
| Players' addresses | The server's memory (limits) and its log (refused joins) | The operator sees them, and nobody else should |
| The game's page | The client runs in it, with its origin's rights | A hole in the client is a hole in every game that uses it |
| The release | `@p3p2/client` on npm, `p3p2/p3p2` on Docker Hub, `DOCKERHUB_TOKEN`, npm's trusted publisher, the `v*` tags, the maintainer's accounts | Code that runs on every server and in every game that updates |

## Who might attack

1. **A stranger** with no secret. They reach the portal, `/api/v1/*`, `/healthz` and the WebSocket, from any number
   of addresses.
2. **Someone with a leaked invite**, possibly an old one.
3. **A guest**, a member who joined through the invite.
4. **A mod**, someone who has the room URL.
5. **Another website** that the player or the owner has open (cross-site requests, reads, framing).
6. **A page on an accepted site**: another game on the same origin, or the game itself turned hostile.
7. **A hostile server**. A player can paste a room URL from any server, and the client has to survive whatever that
   server answers.
8. **Someone on the network**: on the LAN, where the server runs over plain http, and between Caddy and the server.
9. **A contributor's pull request**, which runs its own version of the workflows in CI. The repository is public,
   so this is anybody with a GitHub account.
10. **A compromised dependency, base image or action.**

The operator isn't an attacker here. [docs/security.md](../docs/security.md) says what they can see, and that page
is checked to be true.

## The areas

### 1. Joining

`protocol/src/frames.ts` (hello), `server/src/adapters/ws.ts` (upgrade, origin, the 5 s for hello),
`server/src/core/hub.ts`, `server/src/core/ids.ts`, `server/src/store/sqlite.ts`.

- **Keys and codes**: how they are looked up and compared, and whether a remote attacker can time any of it.
- **Guessing**: how many guesses per second the limits allow, from one address and from many. Is 50 bits of
  invite enough at that rate, for 12 hours?
- **Invites**: expiry while the room is empty, renewal that ends the old code, refusal of an expired or revoked one.
- **Players' identity**: the first browser to use a player id owns it. Can a member take another's id, their
  saved values, or their place through a resume?
- **The room's game**: is a room really held to the first `game.id`, and does the version policy hold?
- **Caps**: members per room, rooms per server, and members in their grace period.
- **The origin**: what a client outside a browser can do with any `Origin` and no key.
- **A kicked member**: can they come straight back with the same invite?
- **Names and chat**: `cleanName` and `cleanText`, for control characters, direction overrides and lengths.

### 2. Routing

`server/src/core/hub.ts`, `protocol/src/frames.ts` (frames and the binary header), `server/src/adapters/ws.ts`.

- **Targets** (`to`): ids in another room, ids that don't exist, very long lists.
- **`sendEach`**: each part reaches only its member. Test the header's lengths for overflow and overlap, and check
  that the whole counts against the sender's rate.
- **Host-only frames**: who may send snapshots, and whether a guest can pass for the host.
- **Saved values**: whether a member can write another player's values, or the room's against the rules.
- **The log**: one order, snapshots by the host only, the cap at `maxLogBytes`, and what a newcomer is handed.
- **Between rooms**: no frame crosses from one room to another, and `from` can't be forged.
- **Presence and chat**: their sizes and rates.

### 3. Flooding

`server/src/core/limits.ts`, `server/src/config.ts`, `server/src/adapters/ws.ts`, `server/src/http/context.ts`,
`server/src/core/hub.ts`, `server/src/store/sqlite.ts`.

- **Every limiter**: per member (frames, bytes), per address (connections, API, logins). Check how much memory the
  limiters' maps take when every request comes from a new address (an IPv6 range).
- **`X-Forwarded-For`**: ignored without `P3P2_TRUST_PROXY`. With it, the last hop is used. What do the documents
  say about a server that trusts a proxy it isn't behind?
- **Connections that never say hello**: the connect rate times 5 seconds, from many addresses.
- **Slow readers**: `bufferedAmount`, dropped volatile messages, when a socket is cut, memory per connection.
- **Large or deep frames**: `maxPayload`, the cost of parsing 64 KB of nested JSON, and regular expressions in the
  validators that might backtrack.
- **The disk**:
  - rooms times their caps;
  - the `invites` table on renewal;
  - `portal_sessions` on every login;
  - `players`, one row for each new browser: does anything bound it?
- **CPU**: scrypt on every login attempt, from many addresses, and the portal's QR codes.

### 4. The portal and the API

`server/src/http/portal.ts`, `pages.ts`, `assets.ts`, `api.ts`, `password.ts`, `context.ts`, `server/src/stats.ts`,
`server/src/server.ts`.

- **Forms from other sites**: the check of `Origin` against `Host` on every form. What happens without an `Origin`,
  and with a forged `Host` behind Caddy?
- **The cookie**: `HttpOnly`, `SameSite=Strict`, and `Secure` only over https. What does a LAN visitor over http
  see?
- **Setup**: the one-time token, two setups at once, and `P3P2_OWNER_PASSWORD` replacing the password and ending
  sessions.
- **Passwords**: scrypt's cost (N=16384, r=8, p=1), the minimum of 8 characters, NFKC.
- **Escaping**: every value in a page. That includes:
  - room names and game URLs;
  - the extra origins;
  - the invite page that a game reports through the API, which the portal shows as a link;
  - the source link from `P3P2_SOURCE_URL`.
- **CSP and headers**: `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `noindex`, `no-store`, on
  every answer, the 404 and the errors included.
- **The room key in addresses**: `/room/<key>`, `Referrer-Policy: same-origin`, links out of the portal (the
  game, the source), browser history, and Caddy without an access log.
- **CORS**: origins are reflected only when some room accepts them, the preflight answer, and no credentials.
- **`/api/v1/stats`**: how the token is compared, no CORS, and absent without a token.
- **Errors**: no stack trace or internal detail reaches a client.

### 5. The database

`server/src/store/sqlite.ts`, `server/src/store/migrations.ts`.

- **Every statement has parameters**, and none is built from strings.
- **What is in clear and what is hashed**: room keys and invite codes in clear; the password with scrypt;
  sessions and players' secrets with SHA-256. Is that right for each, given how much randomness each has?
- **The files**: who owns `/data` in the image, the WAL files, and what a backup holds (every room key). Does
  `docs/self-host.md` say so?
- **Migrations**: forward only. What does a 0.1 image do with a database that a 0.2 image migrated?
- **A crash**: an op is written before it is relayed, as `docs/protocol.md` promises.

### 6. The client

`client/src/*.ts`, `client/src/ui/panel.ts`, `protocol/src/links.ts`, `protocol/src/frames.ts`
(`parseServerFrame`).

- **Nothing from a server or a member reaches markup or runs.** The panel says it uses `textContent`: check every
  place where the DOM is written, attributes and URLs included.
- **The server named in an invite link**: other schemes (`javascript:`, `data:`), http from an https page, and
  addresses on the player's own network. What does the client send to a server it was only told about by a link?
- **Storage**: what is kept, under which keys, for which server. Every script on the game's origin can read it.
  Does `docs/security.md` say so?
- **`unpack`**: hostile input, and a value that decompresses to far more than it was.
- **Values from others**: does the client merge any object it received (`__proto__`)?
- **A hostile server's flood**: timers and memory in the client.
- **The panel in a page**: keyboard capture, the clipboard, and its element in the game's DOM.

### 7. The setup

`deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/docker-compose.build.yml`, `deploy/Caddyfile*`,
`deploy/.env.example`, `docs/self-host.md`.

- **The image**: the user (`node`), what is in it beyond the server (`protocol/test` comes along), the health
  check, and whether it runs with a read-only root.
- **Compose**:
  - only Caddy's ports are published;
  - `env_file` hands every line of `.env` to the server;
  - `P3P2_OWNER_PASSWORD` in the environment, where `docker inspect` shows it;
  - who may read `.env`.
- **Caddy**: no access log, http sent on to https, which headers it adds, the six-day certificates of
  `Caddyfile.ip`, and the floating `caddy:2`.
- **The LAN mode over plain http**: what someone else on the network gets.
- **The log**: what it holds (joins, refused joins with an address, keys cut short), and Docker's rotation.
- **A stranger following `docs/self-host.md` from the top**: does it leave a safe server, with no stats token by
  default and the right public URL?

### 8. The dependencies

- **The server's**: `hono`, `@hono/node-server`, `ws`, `lean-qr`, with `npm audit --omit=dev`, and their versions in
  the lockfile.
- **The client's bundle**: only `lean-qr` and the protocol should be in it. Check the output for anything else.
- **The base image**, pinned by digest: a scan of the published image for amd64 and arm64.
- **The pins**: every action by commit, and `.github/dependabot.yml` keeping them fresh.
- **What was published**:
  - Does the npm tarball of `0.1.0` hold the same files as `npm pack` of `v0.1.0` here, and nothing else?
  - Does its provenance name `release.yml`, `refs/tags/v0.1.0` and `6e3465b`?
  - Do `0.1.0`, `0.1` and `latest` on Docker Hub carry provenance and an SBOM for both machines?
  - Image tags can be pushed again. How would an operator notice a `0.1` that the workflow didn't push, and should
    `docs/self-host.md` say how to pin a digest?

## What iterations 0 and 1 added

### The source link

`P3P2_SOURCE_URL` is checked in `server/src/config.ts` (http or https, at most 400 characters). It is shown in
the footer of every page in `server/src/http/pages.ts` and given as `source` in `/api/v1/info` (CORS `*`). Check:

- whether a value can leave its attribute, or be anything but an http(s) link;
- whether the link, followed from `/room/<key>`, sends the key in a referrer.

### The workflows

- **`ci.yml`**:
  - It holds `contents: read` and checks out with `persist-credentials: false`.
  - A pull request runs its own version of the workflow, with a read-only token and no secret. Can it reach
    anything it shouldn't, or change what a later run on `main` does?
  - The `gha` cache: can a pull request write a cache that `main` reads?
- **`release.yml`**:
  - Who can push a `v*` tag (the tag ruleset), and what `ready` refuses.
  - The `release` environment, limited to `v*` tags.
  - `checks` runs `ci.yml` again.
  - The image job holds `DOCKERHUB_TOKEN`. The npm job alone holds `id-token: write`, and publishes with no
    secret, through npm's trusted publisher. The release builds without a cache.
  - The dry run from the Actions tab: does it really push and publish nothing, and use no environment?
  - Expression injection: is any value an attacker names (a tag, a branch, a title) put into a `run:` script
    through `${{ }}`, and not through `env`?
- **`dependabot.yml`**: what its pull requests can change.

### The settings on GitHub

They are outside the repository, and were set on release day. Read them with `gh api`, and compare them with
`CONTRIBUTING.md`'s "Releasing":

- **The branch ruleset on `main`**: the required checks (`check`, `e2e`, `pack`, `image`), no force push or
  deletion, and who is on the bypass list.
- **The tag ruleset on `v*`**: creation, update and deletion restricted, with Repository admin as the only
  bypass.
- **The `release` environment**: deployments from tags `v*` only, whether it has a required reviewer, and that
  `DOCKERHUB_TOKEN` is its only secret.
- **Actions**: workflow permissions read-only by default, approval for outside contributors' pull requests, and
  whether actions must be pinned to a commit.
- **Security**: private vulnerability reporting, Dependabot alerts, secret scanning with push protection.
- **The history**, now public: anything private in it is out already. A secret found there is rotated, not only
  removed.

### The publishing credentials

- **`DOCKERHUB_TOKEN`**: a personal access token of the user `p3p2`, with read and write on every repository of
  that user, kept only in the `release` environment. Its lifetime, and what someone holding it could push.
- **npm takes no token.** The package's publishing access requires two-factor authentication and disallows
  tokens: check it on the package's settings page. The trusted publisher is GitHub Actions, `doublependu/p3p2`,
  `release.yml`, environment `release`, with `npm publish` allowed. Check:
  - that a run of `release.yml` from a branch, or from a pull request, can't get a token npm accepts. The
    environment takes tags `v*` only;
  - who can push a `v*` tag, and whether anything but the tag ruleset stands between a tag and npm;
  - `0.0.0-stage` and `0.0.1`, the placeholders that created the package: deprecated, with nothing in them.
- **The maintainer's machine**, outside the repository: the npm session that `npm login` left in `~/.npmrc`,
  Docker's and `gh`'s logins. These are info findings at most: what each opens, and when to log out.
- **For each**: what someone who had it could do, and how anybody would notice (a version on npm without its
  provenance, an image without its attestation, a tag nobody pushed).

## A finding

```markdown
### F-01: <what is wrong, in a line>

- **Where**: `server/src/http/portal.ts:123`
- **Scenario**: <who, from the list above>, <what they do>, <what follows>
- **Severity**: high
- **Test**: `server/test/server.test.ts`, "<test name>": fails before the fix
- **Fix**: <what changed>, or **Accepted**: <why>, by <the owner>, <date>
```

| Severity | In p3p2 |
|---|---|
| Critical | A stranger, with nothing, takes over the server, the VPS, a room or the release, or runs code in a game's page |
| High | Someone gets what a secret they don't hold opens (a room's key, the owner's portal, another room's content); a secret leaks; a stranger stops a server for everybody with little effort |
| Medium | A guest or a mod gets past a rule that the documents promise; a stranger slows a server down with some effort; a leak that needs another mistake to matter |
| Low | A limit looser than the documents say; hardening |
| Info | A note, or a gap in the documents |

Each fix comes with its test. When a fix changes what the documents promise, `docs/security.md` changes with it.

## The second pass

Independent of the first: a fresh Claude session, or a person.

- **It gets** this file's "What is worth protecting", "Who might attack", "The areas" and "What iterations 0 and 1
  added", and the repository at the same commit.
- **It doesn't get** `ai/findings_2.md`, or any note from the first pass.
- **It writes** `ai/findings_2b.md`, in the same form, also uncommitted.

Then every finding of the second pass is matched to one of the first, or added to `ai/findings_2.md`. That file
records how many each pass found that the other didn't. If the overlap is small, another pass is worth it.

## Done when

- every critical, high and medium finding is fixed, with its test, or accepted in writing in `ai/findings_2.md`;
- `npm audit --omit=dev` shows nothing high, or each one is accepted;
- the image scan shows nothing high that a newer base image would fix;
- `docs/security.md` says what changed;
- the fixes are released as `0.1.x`, with CI green on `main` and the release workflow green;
- then, and not before, `ai/findings_2.md` and `ai/findings_2b.md` are committed, and a critical or high finding
  has its advisory.

Then comes the VPS, with the audited image.
