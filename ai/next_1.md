# Next 1: 0.1.0 is released

On 2026-10-15, p3p2 `0.1.0` went out: `@p3p2/client` on npm and `p3p2/p3p2` on Docker Hub, from the tag `v0.1.0` on
commit `6e3465b` ("Version 0.1.0"). The repository is public. The security audit and the VPS trial were skipped.

## What was done

1. **The release commit**, `6e3465b`, as `ai/plan_0.md` planned it:
   - every `package.json` and the lockfile at `0.1.0`. The root `package.json` had no version and now has one;
   - `private` removed from `@p3p2/client`;
   - `docs/integrate.md`, section 1: `npm install @p3p2/client` and the jsDelivr script tag (`@0.1`). Building
     from a checkout stays, for unreleased changes;
   - the version in `docs/protocol.md`'s example.

   Beyond the plan:
   - `docs/api.md` names `dist/p3p2.iife.js` in the package and links to the script tag, not `client/dist/`;
   - `CONTRIBUTING.md`'s "Releasing" adds `docs/integrate.md` to what a new minor version changes. `ready` in
     the release workflow doesn't check that file.

2. **The settings**, by you: the repository public, the rulesets, the `release` environment with only
   `DOCKERHUB_TOKEN`, the Docker Hub token and repository, and the Docker Hub texts.

3. **npm's first publish**, which didn't go as `ai/plan_0_me.md` said. See "npm" below.

4. **The tag.** Pushing `v0.1.0` printed "Bypassed rule violations … creations being restricted". That is the tag
   ruleset working: Repository admin is on its bypass list. `release` ran `ready`, `checks`, `image` and `npm`,
   all green.

5. **`c5382fc`**: `release.yml` no longer passes `NPM_TOKEN` to `npm publish`, and `CONTRIBUTING.md` describes the
   trusted publisher as the only way to publish.

## npm

`ai/plan_0_me.md` had 0.1.0 published with a granular token, because a trusted publisher needs a package that
exists. On the day, npm refused a write token without 2FA and pointed to trusted publishing. npm's 2026 changes:

- **July 31, 2026**: tokens that bypass 2FA can no longer manage tokens, access or trusted publishers. Their direct
  publishing is to go in January 2027, leaving staging.
- **Trusted publishers** still need the package to exist (`npm trust` says so). A new one allows only
  `npm stage publish` unless `npm publish` is ticked, and expires unless it publishes within 2 days.
- **October 2, 2026**: `npm stage publish` can create a new package.

What was done:

1. `npm login` here, as `p3p2`.
2. `npm stage publish` of a throwaway `@p3p2/client@0.0.1`: a `package.json` and a README, built in the session's
   scratch folder, not in the repository. It stayed `validating` for about two minutes, then `staged`.
3. The package still didn't exist, although npm's docs say staging publishes a placeholder. It appeared when you
   approved 0.0.1 on the website: versions `0.0.0-stage` and `0.0.1`, `latest` at `0.0.1`.
4. The trusted publisher, on the website: GitHub Actions, `doublependu`, `p3p2`, `release.yml`, `release`, with
   `npm publish` allowed.
5. The tag. The `npm` job published through the trusted publisher with no secret, and `latest` moved to `0.1.0`.
6. You deprecated the two placeholders.

## What was checked after the release

| | |
|---|---|
| npm | `@p3p2/client@0.1.0`, `latest`, MIT, repository `doublependu/p3p2` folder `client` |
| Provenance | SLSA v1, from `.github/workflows/release.yml` on `refs/tags/v0.1.0`, commit `6e3465b` |
| In an empty folder | `npm install` works; `npm audit signatures`: 1 verified attestation; the 4 exports resolve; `pack` round-trips; `Smooth` and `P3P2` import |
| jsDelivr | `@0.1.0` and `@0.1` serve `dist/p3p2.iife.js` (49.6 KB), lean-qr's notice first |
| Docker Hub | `0.1.0`, `0.1` and `latest` are one index (`sha256:380c562f…`), amd64 and arm64, each with an attestation |
| The labels | version `0.1.0`, revision `6e3465b`, `AGPL-3.0-only`, the source link |
| amd64, run here | `/healthz` ok; `/api/v1/info` version `0.1.0` with `source`; the portal footer `p3p2 0.1.0 · Source code` |

**Not checked:**

- **arm64 of the published image.** This machine has no QEMU. CI started an arm64 build of the same commit in
  `checks`, but `image` rebuilt without a cache, so the pushed arm64 image itself has never been started.
- **A VPS.** `docs/self-host.md` already says that pulling the image hasn't been tried on one.

## Left open

- **npm, Publishing access**: "Require two-factor authentication and disallow tokens", at
  `https://www.npmjs.com/package/@p3p2/client/access`. `CONTRIBUTING.md` says it is on. Check it.
- **The GitHub release** from `v0.1.0`. Notes were drafted in the session's scratch folder, which doesn't last.
- **This machine**: `npm login` left a session token in `~/.npmrc`. `npm logout` removes it. The image
  `p3p2/p3p2:0.1.0` is pulled here.
- **The Docker Hub token** has a short life. A release after it expires needs a new one in `release`.

## What comes next

- **The security audit**, now on released code. `ai/plan_security_audit.md` needs updating first:
  - it says "Iteration 1" and names `ai/findings_1.md` and `ai/findings_1b.md`; the audit's iteration number goes
    there instead;
  - its "The tokens" section describes `NPM_TOKEN`, which never existed. npm has the trusted publisher instead,
    with `npm publish` allowed, and tokens disallowed on the package;
  - a fix it leads to goes out as `0.1.1`. The compose file pulls `0.1`, so operators get it with
    `docker compose pull`.
- **The VPS trial**, on the published image, following `docs/self-host.md` from the top. Once it has run, the
  sentence saying that pulling hasn't been tried comes out, and the measurements go in. The bare-address setup
  (`Caddyfile.ip`) is still untried on a public address.
- **Staged publishing in the release**, maybe: `npm stage publish` in `release.yml`, then your approval with 2FA,
  puts a person between a tag and npm. A required reviewer on the `release` environment does much the same today.
- **The example games** of `ai/prompt_0.md`, section 4.

## Your commands

```sh
git add ai/prompt_1.md ai/plan_1.md ai/next_1.md
git commit -m "prompt, plan and next 1: the release of 0.1.0"
```

`ai/plan_0_me.md` and `ai/release_checklist.md` stay uncommitted. `ai/plan_0.md` and `ai/next_0.md` still mention
them.
