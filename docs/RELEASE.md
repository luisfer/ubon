# Release

Ubon releases must prove the package before publishing.

## Local verification

```bash
npm run verify
npm run verify:release
```

`verify` runs lint, build, rule sync, tests, and Ubon-on-Ubon dogfood.
`verify:release` also checks the npm package contents with `npm pack --dry-run`.

## Release checklist

1. Update `CHANGELOG.md` with the target version.
2. Run `npm run verify:release`.
3. Commit with a focused conventional commit.
4. Merge only after PR CI passes on Node 20, 22, and 24.
5. Tag from `main` with `vX.Y.Z`.
6. Let GitHub Actions publish to npm with provenance.
7. Create the GitHub release from the changelog section.

## Post-publish smoke

Run from a clean temporary directory:

```bash
npm install ubon@latest
npx ubon doctor
npx ubon check --schema
npx ubon check --json --fail-on none
npx ubon mcp
```

Then confirm npm, GitHub release, tag, changelog, and `ubon --version` agree.
