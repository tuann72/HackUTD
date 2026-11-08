# Feature: <name>

- **Slug:** `<feature-slug>` (used in branch names: `<type>/<feature-slug>-<short-task>`)
- **Phase:** MVP | Later | Stretch
- **Status:** Not started | In progress | Blocked | In review | Done
- **Owner:** TBD

## Goal

What the feature does and why, in two or three sentences. Link the relevant `AGENTS.md` scope and `CHANGELOG.md` sections.

## Out of scope

What this feature deliberately does not do.

## Open questions

- TBD items that block or shape the tasks below. Link the decision in `CHANGELOG.md` once resolved.

## Tasks

Tasks are grouped into ordered stages. Tasks in the same stage can run **in parallel**. A stage starts only when the stages it depends on are done.

### Stage 1: <name>

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | | — | 1.2 | Not started | | | |
| 1.2 | | — | 1.1 | Not started | | | |

### Stage 2: <name>

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | | 1.1 | — | Not started | | | |

## Task details

### 1.1 <task name>

- **What:** what to build.
- **Files:** what it touches (helps avoid conflicts with parallel tasks).
- **Done when:** how to verify it.

## Progress notes

Dated notes on decisions, blockers, and handoffs, newest first.
