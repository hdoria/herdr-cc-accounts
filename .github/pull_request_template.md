## Motivation

<!-- Why this change exists. Link the issue or the task. -->

## Changes

<!-- What changed, in a few lines. A departure from the standard goes here in one sentence: what was chosen, what was given up, why. -->

Architecture decision: <!-- ADR-NNNN (docs/adr/) or "no ADR". -->

## How it was tested

<!-- The commands you ran and their output (AGENTS.md lists the Definition of Done). A screenshot when the change shows on screen. "Not tested", with the reason, is a valid answer; an empty section is not. -->

## Risk

<!-- Low, medium or high, and where it can break. Anything that touches credentials, the Keychain, ~/.claude or the CI is high. -->

## How to revert

<!-- Is reverting the PR enough? Or is there a written file or a setting that has to be undone by hand? -->

## Checklist

- [ ] No secret, token or real personal data in the diff
- [ ] No debug log
- [ ] CI green (`commits`, `lint`, `test`)
