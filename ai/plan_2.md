# Plan 2: the security audit

This answers `ai/prompt_2.md`. The method is `ai/plan_security_audit.md` as committed in `a938804`: the assets,
the attackers, the eight areas, how a finding is written, the second pass, and when it is done. This plan doesn't
repeat it. It says how this iteration runs it here: in which order, with which tools, where it stops for you, and
how the fixes reach a release without being disclosed first.

This file names no finding and no suspicion, so it can be committed and pushed like any plan. Findings live only
in `ai/findings_2.md` and `ai/findings_2b.md`, kept out of git until the release (decision 1). While the audit
runs, my replies in chat name findings by their id only, so chat history copied into `ai/` discloses nothing
either.

Answer the decisions first. Each one has a recommendation, and "Implement plan 2" without answers means the
recommendations.

## Decisions for you

1. **Keeping findings and their tests out of commits.** *Recommended:*
   - `ai/findings_2*.md`, the advisory drafts, and one new test file per package that holds the tests of open
     findings (`server/test/security.test.ts`, `protocol/test/security.test.ts`, `client/test/security.test.ts`,
     `e2e/tests/security.spec.ts`) are listed in `.git/info/exclude`. That file is local and never committed, and
     `git status` and `git add -A` skip what it names. The test runners still find the files, because they go by
     name.
   - A fix to a tracked file can't be hidden that way. Until the release, you commit locally and don't push
     (decision 5).
   - Or a line in `.gitignore`. It works the same, but it is committed, and tells everybody that something is
     being kept back.

2. **Who runs the second pass.** *Recommended:* a background Claude agent that I start right after the baseline,
   in a git worktree of its own at the audit's starting commit. `CLAUDE.md` allows a worktree when two agents work
   on the repository.
   - It gets the sections the audit plan names, and nothing from the first pass. It is told not to read outside its
     worktree.
   - It starts servers on ports of its own and Docker containers under names of its own, and writes
     `ai/findings_2b.md` in its worktree. It never commits or pushes.
   - When it is done, I copy its file here, then remove the worktree and its branch.

   Or you start a fresh Claude session yourself, from a prompt I write as `ai/prompt_2b.md`. That is more
   independent of me, but you have to start it and tell me when it is done. Or a person.

   Either way, it starts at the same commit as the first pass and before any fix, so both read the same code.

3. **Reading the settings on GitHub.** `gh` isn't installed here, and the audit plan reads the rulesets, the
   `release` environment, Actions' permissions and the security settings with `gh api`. *Recommended:* you install
   `gh` and log in with a fine-grained token that you create for this:
   - for `doublependu/p3p2` only, read-only, expiring in 7 days;
   - with Metadata, Administration, Environments, Actions, Secrets (names only), Dependabot alerts and Secret
     scanning alerts;
   - `! gh auth login --with-token < <the file>`.

   I make only `GET` calls. At the end, you run `gh auth logout` and delete the token. Or you read the pages in the
   browser, from a checklist I put in `ai/findings_2.md`, and paste what they say.

   Some things only you can see either way. Step 4 lists them.

4. **The scanners.** None is installed: no Trivy, Docker Scout, gitleaks, trufflehog or zizmor. actionlint exists
   only as the image `rhysd/actionlint:latest`. *Recommended:* run each from its official image, pinned by digest
   on the day, with the repository mounted read-only:
   - `aquasec/trivy`, reading the published image straight from Docker Hub (`--image-src remote`). It needs no
     Docker socket, and it scans arm64 without QEMU. It downloads its vulnerability database, a few hundred MB;
   - `ghcr.io/gitleaks/gitleaks`;
   - `ghcr.io/zizmorcore/zizmor`, offline;
   - `rhysd/actionlint` at a named version.

   The images are removed at the end. Or install the binaries in `~/.local/bin`.

5. **Where the audit stops for you.** *Recommended:* three kinds of stop.
   - **At once**, whatever step I am on, for a live secret (in the history, the image or the npm tarball) or a
     critical finding. What to rotate, pull or turn off comes before anything else, and only you can do it.
   - **After both passes are merged, before any fix.** You read `ai/findings_2.md`, confirm or change each
     severity, and say "fix" or "accept" for each critical, high and medium finding. An accepted one carries your
     name and the date, as the audit plan asks.
   - **After each critical, high or medium fix.** You commit it with its test, locally, with the message I give,
     and don't push. Low and info fixes come as one batch at the end.

   Or I fix as I go and you review everything at the end. That is faster, but a fix may then rest on a severity
   you would have set differently.

6. **A release when nothing serious turns up.** If no finding is critical, high or medium: *Recommended:* no
   `0.1.1` for the audit alone. The low and info fixes are ordinary commits that you push when you like, and
   `ai/findings_2*.md` is committed with them. Or `0.1.1` anyway, so that the image and the package carry the
   hardening.

## What the code shows

These facts shape the plan. None of them is a finding.

- **`main` runs what was released.** `git diff v0.1.0` touches only `release.yml`, `CONTRIBUTING.md` and `ai/`. The
  server, the protocol, the client and `deploy/` are byte for byte what is on npm and Docker Hub. So the code is
  audited once, on `main`. `release.yml` is audited twice: as it ran for `v0.1.0`, and as it is after `c5382fc`.
- **The size.** About 3,300 lines of server, 800 of protocol and 2,700 of client, plus 260 lines of workflows and
  about 200 of setup. The largest files are the hub (`server/src/core/hub.ts`, 1,100 lines), the client's room
  (`client/src/room.ts`, 860) and the frames (`protocol/src/frames.ts`, 720).
- **Tests reach almost everything without Docker.** `server/test/helpers.ts` has `World` and `FakeConn`, which
  drive the hub on a clock the test controls, and `server/test/server.test.ts` starts a real server on a free port.
  The client's DOM is tested in `e2e/` with Playwright. Only the questions about Caddy need the `E2E_PROXY=1`
  setup, which takes ports 80 and 443 of this machine: `Host`, `X-Forwarded-For`, and the cookie over http and
  https.
- **What was published can be read without an account.** The npm tarball and its attestations come from the
  registry. The image's index, provenance and SBOM come from `docker buildx imagetools inspect`. Only GitHub's
  settings need a login (decision 3).
- **This machine has no QEMU**, as in iteration 1. The arm64 image can be scanned, but not started.
- **There is history beyond `main`.** `git fsck` still finds the unreachable commit of the branch
  `scratch-ready-test` that `ai/next_0.md` mentions. GitHub may keep it too, reachable by its hash. The secret scan
  covers it.
- **`ai/plan_0_me.md` and `ai/release_checklist.md` are no longer in `ai/`.** The audit plan names `plan_0_me.md`
  as its example of a file left out of `git add`. Step 0 points that line at decision 1 instead.

## The steps

### 0. Before the audit

- **You**: the decisions, and `gh` with its token (decision 3).
- **Me**: the lines in `.git/info/exclude` (decision 1), the line in the audit plan, and pulling the scanners'
  images (decision 4).
- **You** commit that line with this plan. That commit is where the audit starts, called S below. Both passes
  read S.

### 1. The baseline, at S

Every check: `npm run lint`, `typecheck`, `test`, `build`, `size`, `test:pack`, `e2e`, and `E2E_PROXY=1 npm run
e2e`. A test that fails later then fails because of a hole, and not because of something already broken. If a
check fails at S, I stop and say so. Node here is 24.18, and the image has 24.22: noted, not changed.

### 2. The second pass starts

As decision 2 says, in the background, at S. It runs while I do steps 3 and 4.

### 3. The scans, and what was published

- `npm audit --omit=dev` for the server, and `npm audit` for everything.
- Trivy on `p3p2/p3p2:0.1.0`, for amd64 and arm64: the system packages, the Node modules in the image, and
  secrets in its layers. Then the same on the base image's digest alone, to tell what a newer base image would
  fix.
- gitleaks:
  - every commit of every ref, plus the unreachable one;
  - the npm tarball of `0.1.0`, and the files of the image.
- actionlint and zizmor on `.github/` at S, and on `release.yml` at `v0.1.0`.
- The client's bundle: nothing in `dist/` but the client, the protocol and lean-qr.
- The npm tarball of `0.1.0` against `npm pack` of `v0.1.0`, built in a copy that `git archive v0.1.0` makes in
  the scratch folder. Its provenance must name `release.yml`, `refs/tags/v0.1.0` and `6e3465b`.
- Docker Hub: `0.1.0`, `0.1` and `latest` are one index, with provenance and an SBOM for each machine. The SBOM's
  packages are compared with the lockfile.
- GitHub's settings (decision 3), against `CONTRIBUTING.md`'s "Releasing".

### 4. The first pass

The areas in this order. What a stranger reaches with nothing comes first, and the client next, because a hole
there is a hole in every game:

1. The portal and the API (area 4), with the source link.
2. Joining (area 1).
3. Routing (area 2).
4. The client (area 6).
5. Flooding (area 3).
6. The database (area 5).
7. The setup (area 7).
8. The dependencies (area 8), with the results of step 3.
9. The workflows, GitHub's settings and the publishing credentials ("What iterations 0 and 1 added").

For each area:

- **What an attacker controls there** goes in `ai/findings_2.md` first, from reading the files the audit plan
  names.
- **Each suspicion becomes a test** in that package's `security.test.ts` (`security.spec.ts` in `e2e/`). It is
  marked `{ todo: 'F-NN' }` (`test.fail()` in Playwright), so it shows as failing while the rest of the suite
  stays green. The fix removes the mark.
- **A try that can't be a test** is a script in the scratch folder: a flood from many addresses, a timing
  measurement, a request through Caddy. It runs against a server on 127.0.0.1 only: the checkout with its data in
  the scratch folder, or the published image with its port bound to 127.0.0.1. Its exact steps go in the
  finding. Floods and timings wait until the second pass has finished, so that two passes on one machine don't
  skew each other's numbers.
- **What was tried and held** is written under the area too, in a line each. The merge in step 5 has to tell
  "looked at, fine" from "not looked at".
- **The documents' promises.** `docs/security.md`, `SECURITY.md` and the security parts of `docs/self-host.md` are
  checked against the code. A promise that isn't true is a finding.

**Your part**, from a checklist in `ai/findings_2.md`. These are pages only you can open:

- npm, `@p3p2/client` → Settings → Publishing access: "Require two-factor authentication and disallow tokens"
  (left open in `ai/next_1.md`), and the trusted publisher's fields;
- two-factor authentication on the npm, Docker Hub and GitHub accounts;
- the Docker Hub token: its scope, its expiry, and when it was last used;
- the npm session that `npm login` left in `~/.npmrc`: whether you still need it.

### 5. Merging the second pass

Every finding of `ai/findings_2b.md` is matched to one in `ai/findings_2.md`, or added there with a new id and a
note that only the second pass found it. The file records how many each pass found that the other didn't. If the
overlap is small, I say so, and you decide whether a third pass is worth it.

### 6. Your review

The second stop of decision 5: severities, and "fix" or "accept" for each critical, high and medium finding.

### 7. The fixes

Critical, high and medium, most severe first. For each:

1. its test fails, then the fix, then its test passes, then every check of step 1;
2. its test moves out of `security.test.ts` into the suite file where it belongs (`hub.test.ts`,
   `server.test.ts`, …), so that a commit never carries the test of a hole that is still open. When the last one
   has moved, `security.test.ts` is deleted;
3. the documents change where a promise changes, `docs/security.md` at least;
4. the finding gets its **Fix** line;
5. you commit it locally, with a message I give that says what changed and not how it could be used. No push.

Then the low and info fixes, the same way, in one batch.

A fix outside the repository (a setting, a token, an account) is a step for you. It goes in `ai/next_2.md`, or
comes at once when it can't wait (decision 5).

### 8. The release of `0.1.1`

If a critical, high or medium finding was fixed, or decision 6 says so:

1. **The release commit**, as `ai/plan_0.md`'s "The release commit: how and when" describes it, with `0.1.1`:
   `npm version 0.1.1 --workspaces --include-workspace-root --no-git-tag-version`, the version in
   `docs/protocol.md`'s example, and every check including `test:pack` and `e2e`. `ready` needs nothing else: the
   compose file and the client's README name `0.1`, and stay. It is left unstaged, for you to commit as
   `Version 0.1.1`.
2. **You** push `main` with the fixes and the release commit at once, wait for CI to be green, and tag `v0.1.1`.
   The fixes are public only for as long as CI and the release workflow take.
3. **Me**: the checks that `ai/next_1.md` made for `0.1.0`, on `0.1.1`: npm and its provenance, jsDelivr's `@0.1`,
   Docker Hub's index and attestations, and the amd64 image run here. Then Trivy on both machines.

### 9. After the release

- **Advisories**: for each critical or high finding, a draft in an excluded file, for you to publish under
  Security → Advisories. For `@p3p2/client`, GitHub's npm ecosystem with `0.1.0` affected and `0.1.1` patched;
  for the image, the same in words, because Docker images aren't an ecosystem there.
- **The npm version**: if a critical or high finding was in the client, you deprecate `@p3p2/client@0.1.0`, with
  a message I draft.
- **The findings**: the lines in `.git/info/exclude` come out, and you commit `ai/findings_2.md` and
  `ai/findings_2b.md`.
- **Cleaning up**: you run `gh auth logout` and delete the token. I remove the scanners' images.

### 10. Close

`ai/next_2.md` is written last, after the release. It covers:

- how many findings there were at each severity, which were fixed, and which were accepted;
- the overlap between the two passes;
- every check, with its result;
- what is left for you, and what comes next: the VPS trial, on the audited image.

If the release waits (you hold it, say), `ai/next_2.md` gives only ids and counts until then, and stays
uncommitted with the findings.

## Done when

As the audit plan's "Done when" says, and also:

- `ai/next_2.md` is written;
- the token is logged out and deleted, and nothing of the audit is left running on this machine.

## Not in this plan

- **The VPS trial.** It comes after, with the audited image.
- **Anything on the internet.** The only servers tried are ones started here. GitHub, npm and Docker Hub are only
  read.
- **Your accounts.** I change no setting on GitHub, npm or Docker Hub, rotate no token, and publish no advisory.
  The steps above say when each of those is yours to do.
- **Installing QEMU.**
- **`bench/` and `e2e/` as targets**, and `examples/` beyond what games copy from them, as the audit plan says.
- **Staged publishing on npm**, unless a finding's fix calls for it.
