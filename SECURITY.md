# Security

If you find a security issue in this Action (or in how it talks to Tarkle's API), please report it
privately rather than opening a public issue:

- Email **team@tarkle.com** with a description and, if possible, steps to reproduce.
- Or use [GitHub's private vulnerability reporting](https://github.com/tarkleHQ/upload-action/security/advisories/new)
  for this repository.

We'll acknowledge the report and follow up with a fix and a coordinated disclosure timeline.

## Scope

This covers the Action itself (`action.yml`, `src/`, `dist/index.js`) and its direct use of the Tarkle
API through [`@tarkle/cli`](https://github.com/tarkleHQ/tarkle/tree/main/tools/tarkle-cli). Issues in
the Tarkle platform itself (tarkle.com) should go to the same address.

## A note on trust

This Action's `dist/index.js` is a built artifact (see the README's Development section) committed to
the repository, not generated at run time. If your workflow runs on untrusted input (for example, it
triggers on a fork's pull request), pin to a full commit SHA rather than a floating tag or branch, so a
later change to this repository cannot silently alter what your workflow runs.
