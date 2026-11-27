# Architecture Decision Records

An Architecture Decision Record (ADR) captures one significant decision: its
context, the decision itself, its consequences and the alternatives that were
considered. ADRs are never rewritten after acceptance; a later ADR supersedes
an earlier one instead.

Contract changes to [`openapi.yaml`](../../openapi.yaml) must be recorded in an
ADR before they are implemented (Assignment 2, requirement 6).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-assignment-2-implementation-sequence.md) | Implementation sequence for Assignment 2 | Accepted |
| [0002](0002-manual-works-and-source-specific-identity.md) | Manual work creation and source-specific identity | Accepted |
| [0003](0003-local-development-security-model.md) | Security model for local development | Accepted |
| [0004](0004-express-as-http-adapter.md) | Express.js as the HTTP adapter | Accepted |
| [0005](0005-react-typescript-vite-frontend.md) | React, TypeScript and Vite for the frontend | Accepted |
| [0006](0006-schema-changes-only-through-migrations.md) | Database schema changes only through migrations (D-4) | Accepted (to be implemented in T1) |

## Format

Each ADR has: **Status**, **Date**, **Context**, **Decision**, **Consequences**
and **Alternatives considered**. File names are `NNNN-short-title.md`.

## Relationship to the architecture documents

The approved architecture is described in
[docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) (v2) and
its decisions AD-1 to AD-13. ADRs record decisions taken after v2 was
approved. Where an ADR changes something in v2, it says so explicitly; the
architecture documents and the T1-T8 roadmap are updated only after the owner
approves that update.
