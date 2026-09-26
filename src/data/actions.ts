/**
 * GitHub Actions used in generated workflows, pinned to full commit SHAs
 * (a moved tag cannot change what runs). Looked up with `git ls-remote` on
 * 2026-09-26; Dependabot keeps this repository's own workflows current.
 */

export const PINNED_ACTIONS = {
  checkout: { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1' },
  setupNode: { uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020', version: 'v7.0.0' },
  uploadSarif: { uses: 'github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2', version: 'v4.38.2' },
} as const;
