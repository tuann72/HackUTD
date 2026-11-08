# Feature: Potential Threat synthetic data (threat, coercion and fake-emergency extortion)

- **Slug:** `potential-threat` (used in branch names: `<type>/potential-threat-<short-task>`)
- **Phase:** MVP (data only; training on it is a follow-up)
- **Status:** In progress
- **Owner:** Tuan + Claude Code

## Goal

The classifier handles threat and coercion texts badly, for example "MOM IM DYING RIGHT NOW GIVE ME $900 OR I EXPLODE" and "YOUR WIFFE IS IN DANGER GIVE ME 500$" (Tuan, 2026-11-08). The training data has almost none of these, and short ALL-CAPS texts in it are mostly ham. This feature adds a seeded, template-based synthetic dataset with a proposed new label **8 = Potential Threat**, hard negatives labeled ham, and a small held-out eval file, so the team can train and measure the new class without touching the real `val`/`test` splits. See `CHANGELOG.md`, "Potential Threat synthetic dataset (proposal)" and `data/README.md`, "Potential Threat synthetic data".

## Out of scope

- Training or deploying a model on the new data (follow-up tasks below, need a label-scheme decision).
- Changing the four 100k CSVs or `data/scam_categories.csv` (adding row 8 there changes `train.py`'s label names and breaks `classifier/tests/test_offline.py`).
- Code changes in `classifier/`, `services/gateway/`, `apps/web/` or `contracts/`.

## Open questions

- **Label scheme (TBD, team):** binary spam/ham, the current 8-class scheme, or 9 classes with Potential Threat. With binary labels the new rows still help (`is_spam` = 1 for threats, 0 for hard negatives). Another option is to fold threats into label 1 (Imposter & Phishing), which already covers "relative in trouble" scams.
- **How to merge (TBD):** append the synthetic file to `scam_categories_100k_full.csv` at train time (`train.py --extra-data`?) or rebuild the full CSV. Appending at train time keeps the 100k files unchanged.
- **Mix (TBD):** how many threat rows relative to the 50k scams; whether to also write a handful of LLM-written or real-style rows to reduce template overfitting.
- **UI wording (TBD):** the badge says "Potential Threat"; whether the notice should suggest calling the loved one or the police.

## Tasks

### Stage 1: Data

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Generator `data/build_threat_synthetic.py`, `data/potential_threat_synthetic.csv`, `data/potential_threat_eval.csv`, docs | — | — | In review | `data/potential-threat-synthetic` | Tuan + Claude Code | [#43](https://github.com/tuann72/HackUTD/pull/43) |

### Stage 2: Train and serve a 9th class (only if the team picks 9 classes)

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Label 8 in `data/scam_categories.csv` + `train.py` extra-data option + tests | 1.1, label decision | 2.3, 2.4 | Not started | | | |
| 2.2 | Retrain (stacked or chosen kind) and evaluate on real test + threat eval file | 2.1 | — | Not started | | | |
| 2.3 | Gateway: `Potential Threat` in `ScamCategory`, keyword fallback rules | label decision | 2.1, 2.4 | Not started | | | |
| 2.4 | Web: badge color and fixtures for `Potential Threat` | label decision | 2.1, 2.3 | Not started | | | |
| 2.5 | Deploy the retrained artifacts to the VM | 2.2, 2.3 | — | Not started | | | |

## Task details

### 1.1 Generator and files

- **What:** stdlib-only, seeded generator. Threat rows (label 8, `is_spam` 1) across family emergency, loved one in danger, kidnapping/ransom, physical threat, blackmail (non-explicit), hitman / "I know where you live", self-harm coercion. Hard negatives (label 0) are genuine urgent family texts and small casual money asks. All rows `split=train`, `is_synthetic=True`, `gen_method=template`. Separate eval file with hand-written-style rows, including Tuan's two examples, `split=eval_threat`.
- **Files:** `data/build_threat_synthetic.py`, `data/potential_threat_synthetic.csv`, `data/potential_threat_eval.csv`, `data/README.md`, this plan, `README.md`, `AGENTS.md`, `CHANGELOG.md`.
- **Done when:** the script produces identical files on two runs, counts are documented, files are small.

### 2.1 `data/scam_categories.csv` and `train.py`

- Add `8,Potential Threat,"Threats, coercion and fake emergencies demanding money: loved one in danger, kidnapping/ransom, harm to the recipient, blackmail, self-harm coercion",` to `data/scam_categories.csv`. `train.py:load_label_names` then returns 9 names automatically.
- `classifier/train.py`: add `--extra-data` (repeatable path) that `pd.concat`s extra CSVs with the same columns onto the main frame before the split masks. Assert extra rows are `split == "train"` so val/test stay real. Without it, label 8 never appears in training and the report shows a zero-support class.
- `classifier/tests/test_offline.py:64`: `len(meta["label_names"]) == 8` becomes 9 (or reads the CSV length). `classifier/tests/conftest.py` comment lists labels.
- `classifier/experiments/compare.py:37`: `list(range(8))` becomes `list(range(9))` (or `range(len(names))`). `compare.py:62` docstring. `zeroday.py` reads names from the CSV and needs no change, but check its per-class loop.
- `classifier/train.py` stacker: features are `2 × n_classes` log-probs (16 → 18) automatically; the `CHANGELOG` "16 class log-probabilities" note becomes 18.
- `classifier/scripts/*.sh`, `classifier/vultr/train_gpu.sh`: copy the two new CSVs to the GPU box (`train_gpu.sh:65` rsyncs only the 100k file and `scam_categories.csv`) and pass `--extra-data`.
- **Service:** `classifier/service/app.py` reads `label_names` from `model.json` (`app.py:44`, `app.py:209`), so it needs no change for a new class.

### 2.3 Gateway

- `services/gateway/src/types.ts:62`: add `'Potential Threat'` to the scam category list (comment "labels 1-7" → "1-8").
- `services/gateway/src/classifier.ts`: the keyword fallback classifier has no threat rules. Add patterns (`in danger`, `kidnap`, `ransom`, `or else`, `i know where you live`, `hurt (you|your)`) with category `Potential Threat`.
- Tests that enumerate categories: `services/gateway/test/classifier.test.ts`, `gateway.test.ts`.
- `contracts/`: `category` is a free string (`query-api.v1.schema.json:90`), so no schema change; optionally add a sample to `contracts/fixtures/messages.v1.sample.json`.

### 2.4 Web

- `apps/web/components/messages/category.ts`: add `"Potential Threat"` to `KNOWN_CATEGORIES` and a color (for example red/amber). Unknown categories already fall back to a neutral badge, so nothing breaks before this lands.
- `apps/web/components/messages/__tests__/helpers.test.ts`, `apps/web/lib/messages/fixture.v1.json`, `apps/web/lib/server/stub.ts` (stub classifier) as needed.

## Progress notes

- **2026-11-08:** Tasks 2.1, 2.2, 2.4 and 2.5 done on `feat/classifier-retrain-threats` (Timothy + Claude Code), with the name changed to **Threats & Extortion**. `--extra-data` wasn't needed: `classifier/build_splits.py` merges the files. In 2.3 the category is in the gateway's list; keyword rules for the stub were not added. Results: `CHANGELOG.md`.
- **2026-11-08 (Claude Code):** task 1.1 built. 4,100 train rows (2,650 label 8, 1,450 label 0) and 100 eval rows (58 / 42). Two runs (and a different `PYTHONHASHSEED`) give byte-identical files; no row matches the 100k corpus or the eval file. ALL CAPS share: 34% of label 8, 38% of label 0. Nothing trained.
- **2026-11-08 (Claude Code):** coverage check of `scam_categories_100k_full.csv`: kidnap/ransom/hostage 86 rows, nearly all Enron spam noise in labels 5/7; "or else / I know where you live" 34, mostly eBay phishing and ham; hitman 2 (ham); "hi mum/dad" family-emergency 143, 139 of them label 1 (all synthetic train). No ALL-CAPS message with a money amount exists, and 215 of 239 short ALL-CAPS texts are ham. The model has no examples of threat-plus-money texts and has seen that caps usually means ham.
