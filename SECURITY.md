# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's Security tab and choose "Report a vulnerability". Do not open a public issue.

Include the Ubon version, how to reproduce the problem, and what an attacker gains. You will get a first answer within 7 days. Fixes are released from the main branch, and the release notes credit the reporter unless you ask not to be named.

## Supported versions

| Version | Security fixes |
| --- | --- |
| 4.x | yes |
| 3.x | until six months after 4.0.0 is released |
| older | no |

## Scope

In scope: anything that makes Ubon run code from a scanned repository, leak a secret in its output, write outside the files it documents, contact the network without being asked, or report a check as clean when it did not run. Also in scope: the published package, the GitHub Action, and the release process.

Out of scope: rules that miss a vulnerability pattern (open a regular issue with an example instead), and command checks that a determined agent can get around; Ubon documents that it is not a sandbox.

How Ubon handles untrusted input and how releases are built: [docs/security.md](docs/security.md).
