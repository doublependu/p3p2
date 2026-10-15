# Contributing

p3p2 stays small on purpose, and knows nothing about the games it carries:
[design-philosophy.md](docs/design-philosophy.md) says how, and the kinds of game it is not for. Before a large
change, open an issue to talk about it.

## Licences

A contribution comes under the licence of the folder it changes, like the code around it. There is nothing to
sign.

- `client/`, `protocol/` and `examples/`: the [MIT License](client/LICENSE).
- Everything else, the server included: the [GNU Affero General Public License, version 3](LICENSE).

## Setting up

Node.js 24, then `npm install` and `npm run build`. The README's
[Try it on one machine](README.md#try-it-on-one-machine) runs a server and the examples.

## The checks

Before a pull request:

```sh
npm run lint && npm run typecheck && npm test   # unit and integration tests
npm run build && npm run size                   # client bundles, against their size budgets
npm run test:pack                               # the client as npm packs it
npm run e2e                                     # host and guests in real browsers
```

The browser tests drive the Chrome installed on the machine. CI runs the same checks, and also builds the
server's image for amd64 and arm64 and starts each one.

Some changes bring a document along, and a test sees to most of them:

- **The client's public types** are named in [api.md](docs/api.md), and the code in the documents for game
  developers is type-checked against them.
- **What goes over the wire** is in [protocol.md](docs/protocol.md), whose examples go through the validators.
  A change within protocol 1 goes in its "Changes within protocol 1".
- **The client's size** has budgets (`npm run size`). A game pays for every byte of the entry on every visit.
- **Documents say what is there today**, not what was or will be.

## Pull requests

- One change in each, with a test where one can be written.
- Commit messages say what changed.
- Changes under `.github/` get a closer look: a pull request runs its own version of the workflows.

A vulnerability goes privately, not in an issue or a pull request: [SECURITY.md](SECURITY.md).

## Releasing

For maintainers. A release is one commit that sets the version of every package, and a tag on it:

```sh
npm version X.Y.Z --workspaces --include-workspace-root --no-git-tag-version
```

With a new minor version, also change `X.Y` in the image tag of `deploy/docker-compose.yml` and in the script
tags of `client/README.md` and `docs/integrate.md`. Commit, push, and once CI is green on `main`:

```sh
git tag vX.Y.Z && git push origin vX.Y.Z
```

The [release workflow](.github/workflows/release.yml) then:

- checks the tag against every version, the compose file and the client's README;
- checks that `@p3p2/client` is not `private`, and that the commit is on `main`;
- runs every check;
- pushes the image to Docker Hub as `X.Y.Z`, `X.Y` and `latest`, for amd64 and arm64;
- publishes `@p3p2/client` to npm.

Both the image and the package come with the provenance of their build. Run from the Actions tab, the same
workflow is a dry run: it builds both and publishes neither.

What it needs:

- **On GitHub**: an environment `release`, which only tags `v*` may deploy to, holding the secret
  `DOCKERHUB_TOKEN`.
- **On Docker Hub**: that token, a personal access token of the user `p3p2` with read and write access.
- **On npm**: a trusted publisher for `@p3p2/client`, with these settings:
  - GitHub Actions;
  - user `doublependu`;
  - repository `p3p2`;
  - workflow `release.yml`;
  - environment `release`.

  npm takes a trusted publisher only for a package that exists. Until then, a granular token for the scope
  `@p3p2`, stored as `NPM_TOKEN` in the environment, publishes instead.
