# Plan 0, Claude's part: ready for the first release

This answers `ai/prompt_0.md`. Your part is in `ai/plan_0_me.md`. Nothing here is published, pushed or made public.

There is no contributor agreement. The prompt's `CLA.md`, signature template, `cla` job and release-workflow
check are all left out.

Answer the decisions first. Each one has a recommendation, and "Implement plan 0" without answers means the
recommendations.

## Decisions for you

1. **Committing.** `CLAUDE.md` says not to commit, and the prompt says to commit on a branch `itr-0`.
   *Recommended:* the prompt wins for this iteration. One commit per step below, on `itr-0`, and no push.
2. **How a server operator gets the setup files** once the server is an image:
   - *Recommended:* clone the repository into `/opt/p3p2`, as today. The image comes from Docker Hub, and the
     clone only provides `deploy/`. Updating is `git pull && docker compose pull && docker compose up -d`, and
     the backup paths in `docs/self-host.md` stay the same.
   - Or download the four files (`docker-compose.yml`, the Caddyfiles and `.env.example`) with `curl` from a
     tag. That needs less on the VPS, but every release then has to change the URLs in the document.
3. **Which tag `deploy/docker-compose.yml` pulls.** *Recommended:* `p3p2/p3p2:0.1`. With it, fixes arrive
   through `docker compose pull`, and a new minor version, which may migrate the database, waits until the
   operator chooses it. `latest` moves to new minor versions without warning. `0.1.0` would never get a fix.
4. **The default source address.** *Recommended:* the repository, `https://github.com/doublependu/p3p2`, shown
   next to the server's version. It is always valid. A link to the tag (`/tree/v0.1.0`) is more exact, but it
   would point to a tag that doesn't exist for a server run from `main` between releases.
5. **The QR library's licence.** The client bundles `lean-qr` (MIT, "Copyright (c) 2021-2025 David Evans"),
   and its notice is in no file the package ships. That includes `p3p2.iife.js`, which jsDelivr will serve
   on its own. *Recommended:* add a one-line `/*! … */` banner to the two files that carry its code
   (`p3p2-qr.js`, `p3p2.iife.js`), which costs about 70 bytes gzipped in each and fits both budgets, and
   add its full notice under a separator in `client/LICENSE`.
6. **A dry run of the release workflow.** The prompt says to write it and not run it, so its first run would
   be on release day. *Recommended:* add a manual `workflow_dispatch` trigger that does everything except
   publishing. It runs `npm publish --dry-run` and builds the image without pushing it, so you can try it
   from the Actions tab while the repository is still private.
7. **Dependabot version updates** for the pinned actions and the base image digest. Without an updater,
   pins go stale. *Recommended:* yes, with a monthly `.github/dependabot.yml` for `github-actions` and
   `docker` only. npm updates are left out, because the lockfile is reviewed by hand.

## What the code shows

These findings shape the plan. None of them reopens a decision from the prompt.

- **The declarations.** The only files that import `@p3p2/protocol` are `core.d.ts` and `room.d.ts`, and
  nothing a game imports reaches them. `index.d.ts`, `types.d.ts`, `smooth.d.ts` and `pack.d.ts` only import
  each other. tsc emits a declaration for every file in the program, and `index.ts` brings in `core.ts`
  through `import type { Controller }` and `import('./core.ts')`. So the fix is to ship only the reachable
  declarations, plus a check that none of them imports a package. Inlining the protocol's types isn't
  needed.
- **Two version numbers.** `server/src/version.ts` repeats `server/package.json`. If the server reads its
  version from its `package.json`, a single `npm version` sets every version. The image already copies
  that file.
- **Docker Hub logs.** A secret with the value `p3p2` (the `DOCKERHUB_USERNAME` in your checklist) would be
  masked as `***` everywhere in the logs, every image name included. The user name goes into the workflow as
  plain text, and only the token is a secret.
- **E2E_PROXY builds from the checkout.** `e2e/proxy/setup.ts` runs `compose up --build`. Once the compose
  file pulls the image, the tests need the build overlay from step 4. Without it they would test Docker
  Hub's image, not the code being tested.

## The steps

After each step: `npm run lint && npm run typecheck && npm test && npm run build && npm run size`, plus
`npm run test:pack` from step 2 on, and `docker build` whenever the Dockerfile changes. Each commit message
says what changed, without iteration numbers.

### 1. The client, ready for npm

- **`client/package.json`**: `description`, `keywords` (multiplayer, websocket, browser-game, game-server,
  self-hosted, rooms, presence, relay), `repository` (`git+https://github.com/doublependu/p3p2.git`, with
  `directory: client`, which npm's provenance check compares against the workflow's repository),
  `homepage`, `bugs`, `author` ("Man & Bot"), `publishConfig` (`access: public`, `provenance: true`),
  `jsdelivr` and `unpkg` set to `dist/p3p2.iife.js` (so that the bare CDN address serves the script-tag
  build), and `"./package.json"` in `exports`. `private` and the version stay as they are until the release
  commit.
- **Declarations that stand on their own**: `client/scripts/types.ts`, run at the end of `build`, starts
  from the declarations named in `exports` and follows their relative imports. It deletes every
  declaration it doesn't reach (`core`, `room`, `local`, `errors`, `ui/*`). It fails if a remaining one
  imports anything that isn't relative.
- **`client/README.md`**, the package page: what it is (it needs a p3p2 server, the Docker image), the
  install, the example from the root README, the script-tag build from jsDelivr, the size, and absolute
  links to the documents on GitHub, because npm doesn't resolve relative ones. It is added to the
  documents that `doc-snippets.test.ts` type-checks.
- **The `lean-qr` notice**, as in decision 5.
- Commit: `client: package fields, README, declarations without the private protocol package`.

### 2. A test of the client as npm packs it

`e2e/pack/packed.test.ts` runs with `node --test`. It is started by `npm run test:pack` at the root and in
the `e2e` workspace. It isn't part of `npm test`, because it takes about a minute and needs Chrome. Like
`size-check.ts`, it expects `npm run build` to have run.

1. `npm pack --workspace @p3p2/client` into a temporary folder, plus a check of the file list: `package.json`,
   `README.md`, `LICENSE`, and `dist/` with only the expected files. No sources, no tests.
2. An empty project, with `npm install <tarball> --offline --ignore-scripts`. The client has no dependencies,
   so nothing is downloaded.
3. **The exports resolve**: `import.meta.resolve` for `.`, `./smooth`, `./pack` and `./iife`. `smooth` and
   `pack` also run in Node, with a round trip through `pack`/`unpack`.
4. **A page type-checks** with the repository's `tsc`, strict, with `skipLibCheck: false`, once with
   `moduleResolution: bundler` and once with `nodenext`. The page imports all three entries and uses
   `Room`, `Member` and `P3P2Error`. The test also asserts that no `.d.ts` in the package imports anything
   outside it.
5. **A Vite build of the page works**, with the repository's `vite` and a `vite.config.js` that has
   `optimizeDeps: { exclude: ['@p3p2/client'] }`, as `docs/integrate.md` says. The output must keep the
   room client, the panel and the QR code as separate chunks, so that they still load lazily.
6. **In Chrome** (Playwright, the installed Chrome, as in the other browser tests), served from a small
   local HTTP server:
   - the IIFE from a `<script>` tag: `window.P3P2`, `P3P2.Smooth` and `P3P2.pack` exist, and
     `new P3P2(…)` puts 👥 on the page;
   - the Vite-built page: 👥 opens the panel, which loads the lazy chunks from the game's own build, with no
     errors in the console.

Commit: `e2e: test the client as npm packs it`.

### 3. The source link

- **`P3P2_SOURCE_URL`** in `server/src/config.ts`: an `http(s)` URL of at most 400 characters. Without it,
  the default is the repository (decision 4).
- **`/info`** gains `source`. In `ServerInfo` it is optional (`source?: string`), because an older server
  doesn't send it. This is a new optional field from the server, which protocol 1 allows. `docs/protocol.md`
  gets it in the REST table and in "Added within protocol 1".
- **The portal**: a footer on every page, `p3p2 <version> · Source code`, with the link escaped like every
  other value. The pages' `Referrer-Policy: same-origin` already keeps the room key, which is in the page's
  address, out of the referrer that the link sends.
- The start-up output gains `Source <url>`.
- **The version** is read from `server/package.json`, and `version.ts` goes away. A test checks that every
  workspace's version is the same.
- **Documents**: the README's settings table, and a section in `docs/self-host.md`, "If you change the
  server", which says what the AGPL asks of an operator and how to point the link at a changed source.
- **Tests**: the setting (default, set, refused), `/info` with `source`, and the footer on a public page.
- Commit: `server: a link to its source code, in the portal and in /info`.

### 4. The server, ready for Docker Hub

- **`deploy/Dockerfile`**:
  - `FROM node:24.<x>.<y>-alpine<z>@sha256:<index digest>`, from `docker buildx imagetools inspect` on the
    day, with a comment saying how to update it;
  - the `deps` stage on `--platform=$BUILDPLATFORM`. The server's dependencies have no native code, and
    SQLite is `node:sqlite`, so `npm ci` doesn't have to run under emulation for arm64. The arm64 smoke test
    in step 6 shows that this holds;
  - the labels `org.opencontainers.image.source`, `.licenses=AGPL-3.0-only`, `.title` and `.description`,
    and `.version` and `.revision` from the build arguments `VERSION` and `REVISION`, with defaults for a
    local build. The workflows pass the build arguments, so the labels have a single source;
  - the header comment changed to `docker run … p3p2/p3p2:0.1`.
- **`deploy/docker-compose.yml`**: `image: p3p2/p3p2:0.1` (decision 3), with no `build`.
- **`deploy/docker-compose.build.yml`**, an overlay for building from a checkout. It adds `build`, renames the
  image `p3p2/p3p2:checkout` and sets `pull_policy: build`, so a local build is never mistaken for Docker
  Hub's `0.1`. It can be turned on once in `.env` with
  `COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml`, after which every command in the document
  works unchanged. `e2e/proxy/setup.ts` adds it, so `E2E_PROXY=1` still tests the checkout.
- **`docs/self-host.md`**, changed to match:
  - step 2 becomes "Get the setup files" (decision 2), and step 3 runs without `--build`;
  - "Updating" uses `pull`, and the backup, restore and removal steps name the pulled image;
  - a new section, "Building from a checkout", holds the rsync and overlay route. That route is how the VPS
    trial runs before the image is published;
  - the sentence "These steps have run as they are on a DigitalOcean droplet" is limited to the route that
    did run. Pulling the image hasn't run on a VPS yet.
- **`deploy/DOCKERHUB.md`**: the short description (at most 100 characters) and the overview, for you to
  paste on Docker Hub. It covers what the image is, its tags, a compose quick start, settings by link, the
  licence and the source.
- README: `Layout` updated.
- Commit: `deploy: the server as an image from Docker Hub, built for amd64 and arm64`.

### 5. The repository's own files

- **`CONTRIBUTING.md`**:
  - that a contribution comes under the licence of the folder it changes: MIT in `client/`, `protocol/`
    and `examples/`, and the AGPL everywhere else. There is nothing to sign;
  - which checks to run;
  - that changes to `.github/` get a closer review, because a pull request runs its own version of the
    workflows;
  - a short "Releasing" section for maintainers: the version command, the tag, the workflow.
- **`SECURITY.md`**: report privately through GitHub's "Report a vulnerability", not in an issue. It says
  what is in scope (the server, the client, the image, `deploy/`), which version is supported (the latest
  0.x), and what to expect. It links to `docs/security.md`.
- **README**: a "Contributing" line pointing to `CONTRIBUTING.md` and `SECURITY.md`.
- Commit: `Contributing and security policy`.

### 6. CI

- **Every action raised to its latest release and pinned by commit**, as `uses: owner/repo@<sha> # vX.Y.Z`.
  The commit comes from `git ls-remote --tags`, dereferenced (`^{}`) for annotated tags. This applies to
  checkout, setup-node, and Docker's setup-qemu, setup-buildx and build-push actions. No metadata action:
  the tags are three names worked out in a shell step, and one action fewer is one dependency fewer.
- **The workflow**: `permissions: contents: read` at the top, `persist-credentials: false` on checkout, and
  a concurrency group that cancels superseded pull request runs, which saves minutes.
- **Jobs**: `check` and `e2e` as today, plus:
  - `pack`: `npm ci`, `npm run build`, `npm run test:pack`;
  - `image`: builds for `linux/amd64,linux/arm64` without pushing, with the `gha` cache. It then loads
    each platform in turn and runs it (arm64 under QEMU). `/healthz` must answer `ok`, `/api/v1/info`
    must have a `version` and a `source`, and the labels must be on the image.
- `on: workflow_call` as well, so the release workflow runs these same checks.
- `.github/dependabot.yml`, if decision 7 is yes.
- Commit: `ci: pinned actions, the packed client and the image for both machines`.

### 7. The release workflow, `.github/workflows/release.yml`

On a tag `v*`, with no permissions by default and one release at a time. `ready`, then `checks`, then
`image`, then `npm`:

1. **`ready`** refuses unless all of these hold:
   - the tag is `vX.Y.Z`;
   - it equals every `package.json` version;
   - `@p3p2/client` isn't `private`;
   - the compose file pulls `X.Y`;
   - the tagged commit is on `main`.

   Its output is the three image tags.
2. **`checks`**: `uses: ./.github/workflows/ci.yml`.
3. **`image`**, in the environment `release`: logs in to Docker Hub as `p3p2` with the secret
   `DOCKERHUB_TOKEN`, then builds and pushes both machines as `0.1.0`, `0.1` and `latest`, with
   `provenance: mode=max` and `sbom: true`, `VERSION` and `REVISION` as build arguments, and no cache, so
   that nothing a pull request wrote can reach a release.
4. **`npm`**, in the environment `release`, after `image`. An image tag can be pushed again, but an npm
   version can't, so npm goes last. Permissions are `contents: read` and `id-token: write`. The job runs
   `npm ci`, the build, and `npm publish --workspace @p3p2/client`. It uses trusted publishing when npm has
   one configured, and the secret `NPM_TOKEN` otherwise (the first publish, see `plan_0_me.md`). Provenance
   comes either way, from `publishConfig`.
5. With decision 6: on `workflow_dispatch`, `ready` checks only what doesn't depend on the tag, `image`
   builds without pushing, and `npm` runs `npm publish --dry-run`. Neither job needs the environment or a
   secret.

Commit: `ci: the release workflow, for npm and Docker Hub`.

### 8. The audit plan, `ai/plan_security_audit.md`

Written for p3p2 as it is at the end of this iteration:

- **What is worth protecting**:
  - the owner's password and sessions, room keys, invite codes, players' secrets and the stats token;
  - what rooms have saved;
  - the server's availability, and the operator's VPS;
  - players' addresses;
  - the game pages the client runs in;
  - the npm package and the image, and the tokens that publish them.
- **Who might attack**:
  - a stranger with no secret, or with a leaked invite;
  - a guest, or a mod (whoever has the room URL);
  - another site in the player's browser;
  - a game page on an accepted origin;
  - a hostile server, which the client must survive;
  - someone on the network;
  - a contributor's pull request;
  - a compromised dependency or action.
- **What each area checks**, with the files to read:
  - **Joining**: `hello`, keys and invites compared in constant time, resume, the game id and version
    policy, caps, grace.
  - **Routing**: targets, `sendEach`, host-only frames, the binary header, no leak between rooms, the log
    order, who may write snapshots and saved values.
  - **Flooding**: every limiter and cap, memory per room and per address, slow readers, timeouts,
    `X-Forwarded-For` with and without `P3P2_TRUST_PROXY`, expensive regular expressions or JSON.
  - **The portal and the API**: the origin check against `Host`, cookies, the login limiter, the setup
    token, password hashing, CSP, escaping (room names, game URLs, origins, the new footer), CORS, the
    stats token, the room key in page addresses and the `Referrer-Policy`.
  - **The database**: statements with parameters, migrations, what is kept in clear, file permissions,
    what a backup holds.
  - **The client**: nothing from the server or a member reaches markup or runs; invite URLs and their
    schemes; where secrets are kept; `unpack` of hostile input.
  - **The setup**: the image (user, volume, health check), compose, Caddy and its access logs,
    `P3P2_OWNER_PASSWORD` in the environment (and `docker inspect`), the LAN mode over http, what the logs
    hold.
  - **The dependencies**: `npm audit`, the lockfile, the bundled `lean-qr`, the base image (a scan with
    Docker Scout or Trivy), the floating `caddy:2`, the pins.
- **What this iteration adds**:
  - `P3P2_SOURCE_URL`, from where it is read to where it is shown;
  - the workflows: each job's permissions; whether a `run:` step can be injected into from a pull request;
    a pull request's ability to change the workflows it runs; the cache; who can push a `v*` tag;
  - the tokens: `DOCKERHUB_TOKEN` and `NPM_TOKEN`, with their scopes, lifetimes and environment, and the
    OIDC `id-token` permission and which jobs hold it.
- **A finding** is written as:
  - an id and a title;
  - where (`file:line`);
  - the scenario: who, what they do, and what follows;
  - the severity: critical, high, medium, low or info, each defined in p3p2's terms;
  - a test that fails before the fix (or exact steps where a test can't be written);
  - the fix, or the reason to accept it, accepted by you in writing.

  They go in `ai/findings_1.md`.
- **The second pass**: a fresh session or a person gets the threat model, the areas and the code, but not
  the first pass's findings. The two lists are then merged, and the overlap between them is recorded.
- **Done when** every high and medium finding is fixed or accepted, each fix has its test, and CI is green.

Commit: `The security audit plan`.

### 9. Close

- `npm run e2e`, and `E2E_PROXY=1 npm run e2e` (the compose files changed; this needs Docker and ports 80
  and 443 of this machine). If those ports are taken, I say so instead of skipping it quietly.
- A local build for both machines with `docker buildx`, if QEMU is installed here. CI does it anyway.
- The workflows, through `actionlint` if it can run here. Otherwise `next_0.md` says they have only been
  read.
- `ai/next_0.md`: what was done, every check with its result, your commands (push `itr-0`, merge, what CI
  should show), how to run the VPS trial from a checkout before the image exists, and what comes next.

## The release commit: how and when

**When:** on release day, after the audit's fixes are merged and the VPS trial is done, and not before.
Until then:

- `docs/integrate.md` can't say `npm install @p3p2/client` while no such package exists, because the
  documents say what is there today;
- `private` keeps an unaudited client from being published by hand;
- `0.1.0` would name code the audit is still changing.

`main` stays green throughout: nothing in this iteration depends on the release commit.

**How:** you ask me for it. On a branch `release-0.1.0` from `main`:

1. `npm version 0.1.0 --workspaces --include-workspace-root --no-git-tag-version`, which sets every
   `package.json` and the lockfile, and through step 3 the server's version too;
2. `npm pkg delete private --workspace @p3p2/client`;
3. `docs/integrate.md`, section 1: `npm install @p3p2/client`, the script tag from jsDelivr, and building
   from a checkout kept for unreleased changes;
4. the version in `docs/protocol.md`'s example;
5. every check, `npm run test:pack` and `npm run e2e`;
6. one commit, `Version 0.1.0`.

You push it, wait for CI, fast-forward `main` to it, and tag that commit. `ready` in the release workflow
refuses a tag whose versions don't agree or whose commit isn't on `main`. The compose file already names
`0.1`. A later minor version changes it in its own release commit.

## Not in this plan

- The audit itself, the VPS, publishing, and making the repository public.
- The example games of the prompt's section 4, and naming `bench/results/games/`.
- Showing the source link in the client's panel. The prompt asks for the portal and `/info`. See the
  open question in `plan_0_me.md`.
