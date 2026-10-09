# Releasing 0.2.1

This patch release ships the embedded working-status fix from PR #1. It adds no
public API or dependency requirement. Existing Pi versions retain their fallback
behavior; Pi 1.1.0 can render working indicators in the editor's top border.

## Registry check (2026-10-09)

The live npm registry reported `latest: 0.2.0`, published at
`2026-08-15T17:12:05.504Z`. The downloaded 0.2.0 tarball did not contain PR #1's
capability declaration or wrapper forwarding methods. Its SHA-1 was
`12850429714241130954756952154d80e85c1e47`.

Always check again before publishing to avoid a duplicate release:

```sh
npm view @crushro/pi-agent-beautify version dist-tags time --json --registry=https://registry.npmjs.org
```

## Validate and publish

Run from a clean checkout containing the release commit, using Node 24:

```sh
npm ci
npm test
npm run typecheck
git diff --check
npm pack --dry-run
```

The lockfile preserves Pi 0.84.1. To check Pi 1.1.0 without changing it:

```sh
npm install --no-save --package-lock=false @earendil-works/pi-coding-agent@1.1.0 @earendil-works/pi-ai@1.1.0 @earendil-works/pi-tui@1.1.0
npm test
npm run typecheck
npm ci
```

With an npm account authorized to publish this package:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
npm view @crushro/pi-agent-beautify@0.2.1 version dist.integrity --registry=https://registry.npmjs.org
```

Supply any OTP requested by npm. There is no repository publishing workflow;
`prepublishOnly` currently checks package contents but does not run tests, so do
not skip the validation above. The package ships TypeScript sources directly.

## Installation verification

After registry publication, in Pi 1.1.0:

```sh
pi install npm:@crushro/pi-agent-beautify@0.2.1
pi list
```

Restart Pi or use `/reload`. Submit a prompt with a configured model. Verify
`Connecting...` / `Thinking...` appears in the editor's top border and clears
after completion or cancellation. Repeat in a separate Pi 0.84.1 environment
to check extension loading and legacy fallback behavior. A pinned installation
will not automatically follow future releases.

## Release preparation evidence

- Pi 0.84.1: 3 passing tests, 1 expected skip (native indicator API unavailable);
  TypeScript check passed.
- Pi 1.1.0: all 4 tests passed against the npm-installed 0.2.1 tarball;
  TypeScript check passed against its installed source.
- Tests explicitly checked both `Connecting...` and `Thinking...` in the top
  border and verified clearing, wrapper forwarding, and opt-out behavior.
- Pi 1.1.0 CLI installed and listed that local npm-installed package using an
  isolated settings directory.
- The tarball contains only LICENSE, README, package.json, and the two source
  files; its runtime source includes the merged fix.
- Full interactive model-session visual verification remains a manual check.
- Publication was not performed: the preparation environment's `npm whoami`
  returned `ENEEDAUTH`.
