# HackUTD Project Context

## Project summary

- **Working name:** Gate Guardian (tentative).
- **Problem:** Scam calls can pressure people, especially older adults, into rash decisions that cause financial, personal, or emotional harm.
- **Concept:** Detect likely scam activity, warn the recipient, and potentially help respond on their behalf while keeping the recipient in control.
- **Hackathon tracks in the current SRS:** Safe Signal (T-Mobile) and Photon. The primary track is not confirmed.
- **Current project state:** Planning. There is no app code yet. The only content beyond docs is a labeled message dataset plus its build scripts in [`data/`](data/) (see [Data](#data)). Do not assume an implementation or technology stack exists until it is present in the repo or agreed by the team.

## Current scope from the SRS

- The SRS points toward an **Android, text-first MVP**: classify scam versus legitimate content with a classical machine-learning model, initially using synthetic message examples.
- The SRS also describes live, in-call scam detection and alerts, plus a possible voice response for the recipient. Treat these as later or stretch scope unless the team decides otherwise.
- A user confirmation step is mentioned before taking the response flow further. The exact action, consent model, and interaction are undecided.
- The SRS mentions Jev for scam classification. Confirm ownership with the team before treating it as current.

## Open questions — do not guess

- What input the MVP actually analyzes: SMS, user-provided text, a transcript, or live call audio. The SRS uses “SMS” and “phone calls” together, so this is ambiguous.
- Which hackathon track is primary and how Photon relates to Safe Signal.
- Android implementation approach, classifier choice and evaluation measures.
- Whether the team adopts the `data/` dataset as the training source, and which label scheme the MVP uses: binary spam/ham or the 8-class scam categories. The dataset exists, but adopting it has not been agreed.
- System architecture, integrations, storage, privacy, permissions, latency, and fail-safe behavior.
- User journey, alert design, what “respond on the recipient’s behalf” means, and when confirmation is required.
- Team roster, ownership, demo narrative, success criteria, and submission checklist.

Keep these items marked **TBD** until the team resolves them. Distinguish agreed decisions from proposals and assumptions.

## Project documents

- **Source SRS:** [HackUTD SRS](https://docs.google.com/document/d/1XIBEqGl1SWqR6r0WXhKSHVs-ZWZYoIjby72qngpZ06o/edit)
- **Design specification:** [`DESIGN.md`](DESIGN.md). It is intentionally blank at project setup and should become the detailed, evolving design document as the team hashes out decisions.

## Data

[`data/README.md`](data/README.md) is the full reference: file purposes, columns, label maps, provenance, cleaning, synthetic-data method and caveats. Key points:

- **`data/scam_categories_100k.csv`:** `message`, `label` (0 = ham, 1–7 = scam groups merged from the FTC Consumer Sentinel categories). `data/scam_categories.csv` maps each label to its name.
- **`data/spam_ham_100k.csv`:** the same 100k messages with binary `label` (1 = spam, 0 = ham) and an older `spam_type` column.
- The `*_full.csv` variants carry the metadata: `split`, `is_synthetic`, `source`, `label_method`, `label_confidence`.
- **Evaluate only on the `val`/`test` splits.** These are 100% real messages and have no synthetic leakage. About 68% of rows are synthetic, and all of them are in `train`.
- **Labels are machine-assigned** (keyword rules plus a classifier), not human-annotated, and the scam classes are imbalanced.
- **Rebuild scripts:** `data/build_100k.py`, `data/recategorize.py`, `data/ftc_taxonomy.py`. The raw source corpora are not in the repo; they are in `~/Downloads/scam_data` on the original author's machine.
- **Repo size:** the large CSVs are 85–93 MB each, under GitHub's 100 MB limit but over its 50 MB warning. They are not committed yet. Decide on Git LFS or a `.gitignore` entry before committing them.

## Instructions for coding agents

1. Read this file before making project changes and inspect the existing code before choosing an approach.
2. Keep this file current as the project evolves. When a task changes an agreed requirement, scope, architecture, technology choice, user behavior, or implementation status, update `AGENTS.md` in the same change so the next agent has accurate context.
3. As design decisions are worked out, record the detailed decisions and rationale in `DESIGN.md`; keep unresolved questions explicit instead of inventing answers.
4. If the SRS, this file, and the code disagree, surface the discrepancy and use the newest explicit team decision. Do not silently turn a stretch idea into an MVP requirement.
5. Preserve user changes and follow any more specific `AGENTS.md` instructions found in subdirectories.
