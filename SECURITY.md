# Security

## Reporting a vulnerability

Report it privately, through GitHub: the repository's **Security** tab, then **Report a vulnerability**
(<https://github.com/doublependu/p3p2/security/advisories/new>). Not in an issue, a pull request or a
discussion: those are public.

Say what is affected, how to make it happen, and what it lets someone do. A test, or the steps that show it, is
the most useful part.

## What is covered

- The server, and its image [`p3p2/p3p2`](https://hub.docker.com/r/p3p2/p3p2).
- The client library, [`@p3p2/client`](https://www.npmjs.com/package/@p3p2/client).
- The setup in [`deploy/`](deploy).
- The workflows that build and publish them.

[docs/security.md](docs/security.md) says what p3p2's keys and checks protect, and what they don't. Something
that page says p3p2 doesn't protect against (a friend who cheats, for one) isn't a vulnerability, though a better
way is welcome as an issue.

## Which versions

The newest release. p3p2 is at 0.x, and a fix comes as a new release. The image's minor tag (`p3p2/p3p2:0.1`)
and `npm update` pick it up.

## What happens next

A first answer within a week. Then a fix, a release, and a published advisory, which names whoever reported the
vulnerability unless they would rather it didn't.
