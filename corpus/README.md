# Corpus

Public repositories that measure how often each rule is right on real code. [docs/precision.md](../docs/precision.md) is generated from the results.

- `repos.json` pins each repository by commit. `paths` limits the check to part of a repository (the workflow repositories are checked for `.github/` only).
- `triage.jsonl` has one line per finding: the repository, rule, file, line, fingerprint, a verdict (`tp` or `fp`), and a note that explains it.

To run it:

```sh
node scripts/corpus.mjs fetch     # shallow clones of the pinned commits into corpus/.cache
node scripts/corpus.mjs run       # check each repository and list findings without a triage line
node scripts/corpus.mjs report    # write docs/precision.md
```

`run --strict` exits with 1 when a finding has no triage line. The weekly `corpus` workflow runs it, so a rule change that adds findings on the corpus needs triage before the next release.

When you triage, read the code around the finding. A `block` finding is a true positive when its message is correct and the fix it suggests is worth doing. A `warn` finding is a true positive when its message is correct and the code is worth a reviewer's look, even if the answer is that it is fine (a public-read policy on a public product catalog, for example). Explain false positives in the note, then change the rule or its fixtures so the same shape is not reported again.
