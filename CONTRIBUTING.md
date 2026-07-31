# Contributing to AegisFlow

## Workflow

1. Create a focused branch from an up-to-date `main`.
2. Follow the module boundaries and accepted ADRs.
3. Add tests for behavior and abuse cases affected by the change.
4. Run `pnpm verify` before requesting review.
5. Use a Conventional Commit such as `feat(identity): add session rotation`.

Do not commit `.env`, tokens, customer data, generated evidence, private prompts or credentials.
New architectural decisions require an ADR in `docs/adr/`.

## Definition of done

A change is complete only when TypeScript, lint, tests, builds and applicable migrations pass;
authorization and tenant boundaries are tested; documentation is updated; and no placeholders,
empty functions or unfinished markers remain in completed functionality.

## Pull requests

Keep pull requests small enough to review. Describe motivation, security impact, verification
commands and migration/rollback behavior. At least one reviewer and all required CI checks are
expected before merge.
