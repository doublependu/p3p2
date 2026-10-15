# Prompt 0: ready for the first release

This is the first iteration in this repository. It started on 2026-10-14 as one fresh commit, its first CI run is
green, and it is private.

The ask: get p3p2 ready for its first release, `0.1.0`. The client goes to npm as `@p3p2/client`, and the server
goes to Docker Hub as `p3p2/p3p2`. In this iteration, make everything the release needs that is code, documents or
workflows. Publish nothing, push nothing, and make nothing public: those steps are mine, later.

Separate what I need to do from what you need to do:
- `ai/plan_0_me.md`
- `ai/plan_0_claude.md`

## 1. Already decided

Don't reopen these unless the code shows a reason.

- **Names**: `@p3p2/client` on npm (the npm user `p3p2` holds the scope), `p3p2/p3p2` on Docker Hub (the user
  `p3p2`), and `github.com/doublependu/p3p2` for the repository.
- **The protocol is not published as a package.** A client in another language can't use a TypeScript package. It
  needs `docs/protocol.md`. So the client's declarations must stand on their own. Today `dist/types/core.d.ts` and
  `room.d.ts` import `RoomRef` and `Auth` from `@p3p2/protocol`, which is private.
- **The server is not on npm.** It ships as the image.
- **`0.1.0`** for the client, the server and the image. The image is tagged `0.1.0`, `0.1` and `latest`.
- **The image is built for amd64 and arm64.**
- **The licences stay as they are**: MIT for `client/`, `protocol/` and `examples/`, and AGPL-3.0-only for the rest.
- **A contributor licence agreement, kept in the repository.** The text is the Harmony individual agreement: a
  copyright licence rather than an assignment, with outbound option five. It goes in `CLA.md`, which I write with a
  lawyer. A contributor signs in their first pull request by adding `.github/contributors/<login>.md`. A `cla` job
  in `ci.yml` fails a pull request whose author has no such file, and skips mine and bots'. No third-party service.
- **The order**:
  1. This iteration.
  2. The security audit (iteration 1).
  3. One VPS, running the audited image, with a real phone in a real room.
  4. On one day: the repository made public, then npm, then Docker Hub. npm's provenance needs a public
     repository, and an AGPL image needs its source to be public.

## 2. What to make

1. **The client, ready for npm**: the `package.json` fields of a public package (description, the repository with
   its directory, homepage, bugs, keywords, the publish settings with provenance), a short README for the package
   page, and declarations that stand on their own.
   - **A test of the client as npm packs it.** Nothing here tests that today: the examples load `client/dist/`
     through `examples/serve.ts`. Pack the client, install the tarball in an empty project, and check that:
     - the `.`, `smooth`, `pack` and `iife` exports resolve;
     - a page type-checks against the package;
     - a Vite build of that page works (with `optimizeDeps.exclude`, as `docs/integrate.md` says);
     - the IIFE file loads in a browser from a `<script>` tag.
2. **The server, ready for Docker Hub**:
   - the base image pinned by digest;
   - the OCI labels: source, licence, version and revision;
   - both machines;
   - `deploy/docker-compose.yml` pulling the image, with building from a checkout still possible;
   - `docs/self-host.md` changed to match.
   - **The source link the AGPL asks for.** A server has to show its users where its source is, for instance with a
     link in the portal and a field in `/info`. The address comes from a setting whose default is this repository,
     so that whoever changes the server can point it at their own source. Keep it within protocol 1.
3. **The repository's own files**:
   - `CONTRIBUTING.md`: why there is an agreement, how to sign it, which checks to run;
   - `SECURITY.md`, pointing to GitHub's private vulnerability reporting;
   - the signature template and the `cla` job;
   - a "Contributing" line in `README.md`.
   - `CLA.md` is mine. Until it is there, the release workflow refuses to run.
4. **CI**: the actions raised to their current versions and pinned by commit (v4 of checkout and setup-node runs on
   Node 20). Add a job that runs the packed-client test of item 1, and a job that builds the image for both machines.
5. **The release workflow**, written but not run. On a tag `v*`, it:
   - runs the checks;
   - runs `npm publish` through npm's trusted publishing, with provenance;
   - pushes the image for both machines to Docker Hub, with provenance and an SBOM.

   Tell me exactly what to set on npm, Docker Hub and GitHub for it, including the names of the secrets.
6. **The release commit**: every version at `0.1.0`, `private` off the client, and `docs/integrate.md` saying
   `npm install @p3p2/client`. It is the commit I tag. Say how and when it gets made: `main` has to pass CI until the
   release day.
7. **The audit plan.** This repository doesn't have one. Write `ai/plan_security_audit.md` for p3p2 as it is.
   - What it covers:
     - what is worth protecting, and who might attack;
     - what each area checks: joining, routing, flooding, the portal and the API, the database, the client, the
       setup, and the dependencies;
     - what this iteration adds: the source link, the workflows, and the tokens they hold.
   - How a finding is written: where, the scenario, the severity, a test, and the fix or the reason to accept it.
   - A second, independent pass by a fresh session or a person.

   Iteration 1 runs it.

## 3. Rules

- **Documents and code comments say what is there today**, and don't point into `ai/`.
- **`ai/` becomes public with the rest of the repository, history and all.** It names no game outside `examples/`,
  and nothing private.
- **Commit messages become public history too.** They say what changed, without iteration numbers. Commit on a branch
  `itr-0`; I push.
- **After each step**: lint, typecheck, `npm test`, build, size. `npm run e2e` runs before the close.
- **Close with `ai/next_0.md`**: what was done, the checks, and my commands.

## 4. Not in this iteration

- The audit itself, the VPS, publishing, and making the repository public.
- **Example games that cover what no test here reaches.** They come after the release, a few at a time. What they
  should reach:
  - the client as npm packs it, in a game's own build (item 1 covers the package; a game would cover a real build);
  - Chrome, Firefox and WebKit in one room, building the same world from the same seed (`otherEngines`);
  - a phone with touch: the panel beside a game's own touch controls, a thumb that stays down, a page that cancels
    touches (`phoneContext`, `fingers`);
  - rooms of four to eight players (the examples have three at most);
  - what a room costs the server (`measure`);
  - one room across several pages of a game;
  - the panel over a 3D canvas;
  - a host that hands on a running world in the middle of it;
  - the calls no test reaches: `ui: false`, the `game.version` check, `member.order`, the `close` event, `peek()`,
    `ui.chatKey`, and most `P3P2Error` codes (`mixed`, `full`, `rate`, `proto`, `player`, `unreachable`);
  - the calls only unit tests reach: `Smooth` and `pack` in a browser, `to: [ids]`, `member.rtt`, the `replaced`
    leave reason.
- `measure` in `e2e/tests/helpers.ts` writes to `bench/results/games/`. Name that folder for the examples when the
  first one is measured.
