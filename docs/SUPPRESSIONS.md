# Inline Suppressions

Ubon supports inline suppressions that let you silence a specific rule for the next line only. This is useful for edge cases where a finding is intentional and safe.

## Syntax

Single-line comment (JS/TS/Vue/Next.js):

```ts
// ubon-disable-next-line RULEID [optional reason]
eval('safe-demo')
```

Block comment:

```ts
/* ubon-disable-next-line RULEID optional reason */
const token = 'eyJ...';
```

- `RULEID` is the rule identifier, e.g. `SEC016`, `A11Y001`, `NEXT007`.
- The optional reason is free text and will be shown in human output when `--show-suppressed` is enabled.

## CLI controls

- `--show-suppressed`: include suppressed results in human output (marked as `[SUPPRESSED]`).
- `--ignore-suppressed`: hide suppressed results completely (default behavior is to hide from listing but still count in triage totals).

Examples:

```bash
# Show suppressed results (for triage transparency)
ubon check --show-suppressed

# Hide suppressed results entirely (do not count towards totals)
ubon check --ignore-suppressed
```

## Best practices

- Prefer fixing issues over suppressing them.
- Add a brief reason for future reviewers.
- Use narrowly scoped suppressions; never blanket-disable important security rules across files.

## Notes

- Suppressions are matched against the previous line relative to the finding (i.e., they apply to the next line following the suppression comment).
- Suppressions support both relative and absolute file paths during detection.
