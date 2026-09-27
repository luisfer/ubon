# Add a dependency

Use before you install a package or add one to `package.json`. Package names that models suggest are sometimes wrong or made up, and attackers register those names.

1. Check whether you need a package at all. Prefer the platform (Node's `fetch`, `crypto.randomUUID()`, `util.parseArgs`, `Intl`) and packages already in the dependency tree.
2. Check the name: `ubon vet <package>`. It reports whether the package exists on the registry, how old the package and the version are, whether the name is one edit away from a popular package, and whether it has a malicious-package record. Several names can be vetted at once: `ubon vet zod date-fns`.
3. If `ubon vet` reports a problem, do not install the package. Tell the user what it reported and suggest the package you think was meant, if any.
4. Install with the project's package manager (look at the lockfile: `package-lock.json` for npm, `pnpm-lock.yaml` for pnpm, `yarn.lock` for Yarn, `bun.lock` for Bun), with an exact or caret version, and commit the lockfile with the change.
5. Mention in your report any new package that runs install scripts; Ubon warns about them (`deps/install-script`).

Inside an agent session with Ubon's hooks, install commands are checked before they run: a package whose name imitates a popular one is stopped for a person to approve, and so is a package that does not exist or was published hours ago when `packages.online` is set in `ubon.json`. `ubon vet` always looks packages up, so run it first.
