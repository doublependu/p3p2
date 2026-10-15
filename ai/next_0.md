# Next 0: ready for the first release

What iteration 0 did, against `ai/plan_0.md` with decisions 2 to 7 as recommended. Every change is on `main` in the
checkout, unstaged. Nothing is committed, pushed or published.

## What was done

1. **The client, ready for npm.**
   - `client/package.json` has the fields of a public package, with `publishConfig` (`access: public`,
     `provenance: true`), `jsdelivr`/`unpkg` and `./package.json` in `exports`.
   - `client/scripts/types.ts` runs at the end of the build. It keeps the 4 declarations that `exports` reaches
     (`index`, `types`, `smooth`, `pack`), removes the 7 that import `@p3p2/protocol`, and fails if a kept one
     imports a package.
   - `client/README.md` is the package page. Its code is type-checked with the other documents.
   - lean-qr's notice is a banner on `p3p2-qr.js` and `p3p2.iife.js`, added after minification, which dropped it
     otherwise. Its licence text is in `client/LICENSE`.
2. **`npm run test:pack`** (`e2e/pack/packed.test.ts`, 9 tests, about 2 seconds):
   - packs the client and checks the tarball's files;
   - installs it offline in an empty project, and checks that the 5 exports resolve and that `smooth` and `pack`
     run in Node;
   - type-checks a page with `skipLibCheck: false` under `bundler` and `nodenext`;
   - builds the page with Vite, and checks that the entry stays under 6 KB with the lazy parts apart;
   - in Chrome, loads the IIFE from a `<script>` tag and the built page, opens its panel and a room of one.

   It fails when the unreachable declarations ship: tried by putting them back.
3. **The source link.**
   - `P3P2_SOURCE_URL` (http or https, at most 400 characters) defaults to this repository.
   - It appears in a footer on every portal page (`p3p2 <version> · Source code`), as `source` in `/info`
     (optional in `ServerInfo`, added to protocol 1's list), and on the start-up output.
   - The server's version is read from `server/package.json`, and a test checks that every package has it.
4. **The image.**
   - Node `24.22.0-alpine3.24` pinned by its index digest. The dependencies are installed on the build machine's
     platform and copied (no native code, checked).
   - OCI labels, with `VERSION` and `REVISION` passed as build arguments.
   - `docker-compose.yml` pulls `p3p2/p3p2:0.1`. `docker-compose.build.yml` builds the checkout as
     `p3p2/p3p2:checkout`, turned on once with `COMPOSE_FILE` in `.env`.
   - `E2E_PROXY` uses the build overlay.
   - `docs/self-host.md` covers the clone, `pull`, "Building from a checkout" and "If you change the server".
     It says that pulling the image hasn't been tried on a VPS yet.
   - `deploy/DOCKERHUB.md` holds the Docker Hub texts.
5. **The repository's files**: `CONTRIBUTING.md` (licence by folder, checks, review of `.github/`, releasing and
   what the release needs), `SECURITY.md`, and a "Contributing" section in the README.
6. **CI.**
   - Every action is at its latest release, pinned by commit: checkout v7.0.1, setup-node v7.1.0, setup-qemu
     v4.4.0, setup-buildx v4.4.1, build-push v7.4.0, login v4.6.0. All of them run on Node 24.
   - `contents: read`, no persisted credentials, and superseded pull request runs cancelled.
   - New jobs: `pack`, and `image`, which builds and starts amd64 and arm64 and checks the health, `/info` and
     the labels.
   - `ci.yml` is callable by other workflows. `dependabot.yml` updates the actions and the base image monthly.
7. **`release.yml`**, on a tag `v*`, in four jobs:
   - `ready` refuses a tag unless all of these hold: it is `vX.Y.Z` and matches every version; the client isn't
     private; the compose file and the client's README name `X.Y`; the commit is on `main`;
   - `checks` runs `ci.yml`;
   - `image` pushes `X.Y.Z`, `X.Y` and `latest` for both machines, with provenance and an SBOM, and no cache;
   - `npm` publishes through trusted publishing, or `NPM_TOKEN` before there is one.

   Run from the Actions tab, it is a dry run without an environment or a secret.
8. **`ai/plan_security_audit.md`**: the assets, the attackers, eight areas with their files, what this iteration
   added, how a finding is written, the second pass, and when it is done.

### Where it differs from the plan

- `server/src/version.ts` stays, and reads `server/package.json` instead of repeating it.
- `ready` also checks the script tag in `client/README.md`, which names `X.Y` like the compose file.
- The `image` job builds each machine on its own and starts it. It doesn't also make one combined build, which
  would be the same work twice.
- `@p3p2/client`'s devDependency on the protocol is now `*`, like the other workspaces. `^0.0.0` would stop
  matching once `npm version` moved the protocol to 0.1.0.
- `CONTRIBUTING.md` lists what the release needs on GitHub, Docker Hub and npm, because `release.yml` points
  there and documents must not point into `ai/`.
- `SECURITY.md` promises a first answer within a week. Change it if that's wrong for you.

## The checks

All of them passed at the end, and after every step.

| | |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | 155 tests, 0 failed (server 96, protocol 23, client 15, e2e node 11, bench 10) |
| `npm run build`, `npm run size` | every budget kept; the QR code is 2.52 KB and the IIFE 17.69 KB with the notice |
| `npm run test:pack` | 9 passed |
| `npm run e2e` | 29 passed |
| `E2E_PROXY=1 npm run e2e` | 29 passed, with the server built through `docker-compose.build.yml` |
| `docker build`, then running it | `/healthz` ok; `/info` with `version` and `source`; the labels; no `.node` files |
| The `image` job's script, run here for amd64 | passed |
| `release.yml`'s `ready` script, run here | refuses the current tree; accepts a copy with the release commit; refuses a wrong tag, a commit off `main`, and `v0.1` |
| `actionlint` 1.7.12, with shellcheck | clean |

**Not tried here:**

- **arm64**: this machine has no QEMU, and installing it changes the kernel's settings. The `image` job in CI
  builds and starts arm64.
- **The workflows themselves**: their first real run is your first push. The `''` environment of the dry run
  is first exercised by the dry run.

**Also on this machine:**

- **A slip of mine, already cleaned up**: while testing `ready` in a scratch clone, I pushed a branch,
  `scratch-ready-test`, into this repository by mistake. I deleted it at once, and `git branch` shows only
  `main`. Its commit is left as an unreachable object until git collects it.
- **Images**: `rhysd/actionlint:latest` was pulled, and `p3p2/p3p2:checkout` was built.

## Your commands

1. Look over the changes: `git status`, `git diff`, and the new files.
2. Commit, in one piece:

   ```sh
   git add -A
   git commit -m "Ready for the first release: the client for npm, the server's image for Docker Hub, and the release workflow"
   ```

   Or one commit per step, with these files and messages. `README.md` has lines from steps 3, 4 and 5: add it
   with step 5, or use `git add -p`.

   | Step | Files | Message |
   |---|---|---|
   | 1 | `client/`, `package-lock.json` | `client: package fields, README, declarations without the private protocol package` |
   | 2 | `e2e/pack/`, `e2e/package.json`, `e2e/tsconfig.json`, `package.json` | `e2e: test the client as npm packs it` |
   | 3 | `server/`, `protocol/src/frames.ts`, `e2e/node/harness.ts`, `bench/test/load.test.ts`, `docs/protocol.md` | `server: a link to its source code, in the portal and in /info` |
   | 4 | `deploy/`, `e2e/proxy/`, `docs/self-host.md` | `deploy: the server as an image from Docker Hub, built for amd64 and arm64` |
   | 5 | `CONTRIBUTING.md`, `SECURITY.md`, `README.md` | `Contributing and security policy` |
   | 6 | `.github/workflows/ci.yml`, `.github/dependabot.yml` | `ci: pinned actions, the packed client and the image for both machines` |
   | 7 | `.github/workflows/release.yml` | `ci: the release workflow, for npm and Docker Hub` |
   | 8 | `ai/plan_security_audit.md`, `ai/next_0.md`, `ai/plan_0_me.md`, `ai/release_checklist.md` | `The security audit plan` |

3. `git push`. CI should show `check`, `e2e`, `pack` and `image`, all green. `image` takes the longest the first
   time, before its cache exists.
4. Actions → `release` → Run workflow, on `main`: a dry run. It should end green, with the image built for both
   machines and `npm publish --dry-run` showing the package. Because the client is still private, npm says it
   skips it, which is expected for a dry run.
5. Settings → Billing, after a few runs, for the minutes.

## The VPS trial, before the image exists

The repository is private and the image isn't published, so the VPS builds the server from a checkout, as
`docs/self-host.md` says under "Building from a checkout":

```sh
# from here
rsync -az --delete --filter=':- .gitignore' --exclude=.git --exclude=.env \
  ./ root@<the VPS>:/opt/p3p2/
# on the VPS
cd /opt/p3p2/deploy
printf 'P3P2_DOMAIN=<the name>\nCOMPOSE_FILE=docker-compose.yml:docker-compose.build.yml\n' > .env
docker compose up -d
docker compose logs p3p2
```

The portal's footer should show the source link. On release day, removing the `COMPOSE_FILE` line and running
`docker compose up -d` switches to the published image, and the database stays.

## What comes next

- **Iteration 1, the audit**: `ai/prompt_1.md` asks for `ai/plan_security_audit.md` to be run.
- **Then the VPS**, as above, then release day as `ai/plan_0_me.md` says. When you ask for the release commit, I
  make it unstaged on `main` as `ai/plan_0.md` describes.
- **The example games** of `ai/prompt_0.md`, section 4, after the release.
