# Next 2: the security audit, and 0.1.1

The audit of `ai/plan_2.md` ran on 2026-10-15 against `a11d985`, whose server, protocol, client and `deploy/` are
byte for byte what `v0.1.0` released. Two of its findings are fixed in `0.1.1`. The others are deferred, and are
kept outside the repository until they are fixed.

## What was done

1. **The baseline, the scans and what was published** (plan step 1 and 3), with nothing to stop for: no live
   secret in the history, the image or the npm tarball, and no critical finding.
   - `npm audit`, for the server alone and for everything: 0 vulnerabilities.
   - Trivy on `p3p2/p3p2:0.1.0`, amd64 and arm64: the server's four dependencies are clean. Everything it finds is
     in the base image's own copy of npm, which the server never runs; the newest `node:24-alpine` has the same.
   - gitleaks over every ref, the unreachable commit, the npm tarball and the image: one false positive, a test
     fixture.
   - The npm tarball of `0.1.0` is byte for byte what `v0.1.0` packs, and its provenance and the image's name the
     release workflow, the tag and `6e3465b`.
   - actionlint and zizmor on the workflows: nothing above medium.
2. **Two passes** (plan steps 2, 4 and 5): the first in this checkout, the second by a separate Claude agent in a
   worktree of its own at the same commit, given only `ai/plan_security_audit.md`. The worktree and its branch are
   gone.
3. **Your review** (step 6), on 2026-10-16: fix two findings now, and defer the rest until p3p2 has users in the
   field and a suite of example games that can tell whether a fix breaks a game. Deferring is "accepted for now",
   in the audit plan's words.
4. **The two fixes**, which no game can notice:
   - **Request bodies of at most 64 KB** (`MAX_BODY_BYTES` in `server/src/http/context.ts`). The portal refuses a
     larger one with 413 before reading it. `POST /api/v1/room/invite` doesn't read a larger one, and answers as
     for an empty body, so a game page with a very long address still gets its invite.
   - **Login attempts are counted before the password is checked**, and the right password gives its attempt
     back, so tries sent all at once count as tries one after another do (`KeyedLimiter.give`, which replaces
     `allows`).
   - Three tests in `server/test/server.test.ts`; `docs/security.md` ("Limits") and `docs/protocol.md` say so.
5. **The release commit**: every package at `0.1.1`, the version in `docs/protocol.md`'s example, and the tarball's
   name in `docs/integrate.md`.

What went differently from `ai/plan_2.md`:

- Steps 7 to 9 shrank to the two fixes. No advisory is drafted, and the findings are not committed after the
  release: most of them are still open.
- `.git/info/exclude` no longer lists the findings and their tests. They moved out of the checkout, where they
  can be found again; `ai/prompt_3.md`, which isn't committed, says where.

## The checks

| | |
|---|---|
| `npm run lint`, `npm run typecheck` | Clean |
| `npm test` | protocol 23, server 99, client 15, e2e's node tests 11, bench 10: all pass |
| `npm run build`, `npm run size` | Every budget kept; nothing in the client changed |
| `npm run test:pack` | 9 pass |
| `npm run e2e` | 29 pass |
| `E2E_PROXY=1 npm run e2e` | 29 pass, through Caddy over https |

## Your commands

The fix first, then the release commit. `docs/protocol.md` holds a line of each: stage only its 64 KB hunk with
the fix.

```sh
git add server/src server/test/server.test.ts docs/security.md
git add -p docs/protocol.md        # only "A body larger than 64 KB is not read, and counts as an empty one."
git commit -m "Limit request bodies to 64 KB, and count login attempts before the password is checked"
git add -u
git commit -m "Version 0.1.1"
git add ai/next_2.md
git commit -m "next 2: the security audit, and 0.1.1"
git push origin main
# once CI is green on main:
git tag v0.1.1 && git push origin v0.1.1
```

Then I make the checks `ai/next_1.md` made for `0.1.0`, on `0.1.1`: npm and its provenance, jsDelivr's `@0.1`,
Docker Hub's index and attestations, and the amd64 image run here.

## Left open

- **Your part of the audit**, pages only you can open: the rulesets' bypass lists, Actions' settings, the `release`
  environment, code security and its alerts on GitHub; publishing access and two-factor authentication on npm;
  the Docker Hub token's scope and expiry; `npm logout` on this machine.
- **The deferred findings.** None is critical. They wait for `ai/prompt_3.md`'s examples.

## What comes next

- **`ai/prompt_3.md`**: example games inside p3p2 whose tests reach what real games reach, run against old and new
  clients and servers. The deferred fixes come after it.
- **The VPS trial**, on the `0.1.1` image.
