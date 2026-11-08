# Feature: Nemotron second-opinion review with bank checks

- **Slug:** `nemotron-review`
- **Phase:** Stretch (hackathon demo)
- **Status:** In review
- **Owner:** Timothy + Claude Code

## Goal

A second line of defense for messages the stacked model is unsure about. When the score lands in the review band, Nemotron picks read-only checks against the victim's (mock) bank data from Capital One's Nessie API, the gateway runs them, and Nemotron returns block or deliver with a one-line reason.

## Out of scope

- Scores outside the band: they keep the model's decision.
- The Vercel backup route, which classifies before it answers the webhook.
- Real bank data. Nessie is a mock bank, and the fallback is local mock data.
- Any reply to the sender.

## Design

1. The gateway classifies as usual. Outside `REVIEW_BAND_LOW` to `REVIEW_BAND_HIGH` (defaults 0.22 and 0.77), nothing changes.
2. Nemotron returns JSON naming checks from a fixed list (`bills`, `purchases`, `accounts`, `loans`) with an optional keyword and amount.
3. The gateway runs them. Nemotron never gets a tool or a URL, and sees only `found`, a count and short labels, never balances.
4. Nemotron returns `block` or `deliver` and a short reason, stored as `verdict.review`.
5. Any failure or timeout (`REVIEW_TIMEOUT_MS`) keeps the model's decision.

`REVIEWER=off` is the default. No migration: the review lives in the existing verdict JSON, and `reason` stays `model_verdict`.

Nessie is used when `NESSIE_API_KEY` and `NESSIE_ACCOUNT_ID` are set and it answers. Otherwise local mock data is used, and `verdict.review.bankSource` says which (`nessie` or `mock`).

## Open questions

- Team agreement on the NVIDIA track and on sending mock bank results to NVIDIA: **TBD**.

## Tasks

| # | Task | Depends on | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|
| 1 | Reviewer, bank checks, wiring, tests | — | Done | `feat/nemotron-review` | Timothy + Claude Code | [#59](https://github.com/tuann72/HackUTD/pull/59) |
| 2 | Contract field and UI reason line | 1 | Done | `feat/nemotron-review` | Timothy + Claude Code | [#59](https://github.com/tuann72/HackUTD/pull/59) |
| 3 | Live test with real keys, then deploy | 1, 2 | Not started | — | — | — |
