# Scam / Spam Message Datasets

Labeled SMS and email messages for training spam and scam classifiers. All files are UTF-8 CSVs with a header row. Message text is kept whole; multi-line SMS messages are quoted.

**Which file to use**

| Goal | File |
|---|---|
| Classify **scam type** (8 classes) | `scam_categories_100k.csv` |
| Classify **spam vs ham** (binary) | `spam_ham_100k.csv` |
| Need metadata (splits, source, synthetic flag, label confidence) | the matching `*_full.csv` |
| Only the original real messages, no synthetic rows | `unified_spam_dataset.csv` |
| Threat / coercion / fake-emergency extortion texts (proposed label 8) | `potential_threat_synthetic.csv` (train), `potential_threat_eval.csv` (held-out) |

---

## 1. `scam_categories_100k.csv` (main dataset, multi-class)

100,000 rows, 2 columns: `message`, `label`.

The labels are based on the FTC Consumer Sentinel report categories ([category definitions PDF](https://www.ftc.gov/system/files/attachments/data-sets/category_definitions.pdf), Jan 2024). The FTC's 28 fraud and "other" categories are merged into 7 scam groups, and 0 is used for ham:

| label | name | what it covers | rows |
|---|---|---|---|
| 0 | Ham | Legitimate, non-spam messages | 50,000 |
| 1 | Imposter & Phishing | Pretends to be a bank, wallet, courier, government agency, tax office, debt collector, tech support, charity or relative in order to steal money or credentials. Also includes malware and security scares. | 6,606 |
| 2 | Prizes, Lotteries & Advance-Fee | Fake winnings, sweepstakes, 419 inheritance/foreign-money letters, fake checks, and "free grant" offers that require a fee first | 7,592 |
| 3 | Jobs, Business & Investment | Work-from-home and task/job scams, MLM, stock pump-and-dump, crypto and guaranteed-return schemes | 6,330 |
| 4 | Loans, Credit & Debt | Loan and payday offers, mortgage refinancing, debt relief, credit repair, credit reports | 1,737 |
| 5 | Health & Pharmacy | Online pharmacy, pills, weight loss, supplements, enhancement products, miracle cures | 13,529 |
| 6 | Shopping & Product Offers | Retail promos, replicas, software, electronics, office supplies, cars and warranties, home and real estate, travel, magazines, education, funeral plans | 5,393 |
| 7 | Internet, Telecom & Media | Online gambling, adult/dating sites, SEO and bulk-email marketing, premium SMS, ringtones, phone plans, TV/streaming/music | 8,813 |

`scam_categories.csv` holds this table in machine-readable form, including which FTC categories were merged into each group.

The classes are **imbalanced**: Health & Pharmacy is about 8× the size of Loans. Use class weights or oversample the training split.

### `scam_categories_100k_full.csv`

Same rows, plus these columns:

| column | meaning |
|---|---|
| `id` | Stable row id (`r…` = real, `s…` = synthetic) |
| `label_class` | Same as `label` above (0–7) |
| `category_name` | Name of the group |
| `ftc_subcategory` | Original FTC category number 1–28 when a rule identified it, 0 for ham, -1 if unknown |
| `label_method` | `ham`, `rule` (keyword rules matched with high confidence), or `model` (predicted by a classifier trained on the rule-labeled rows) |
| `label_confidence` | 1.0 for rule labels, otherwise the classifier's probability |
| `is_spam` | 0/1 binary label |
| `source`, `style`, `is_synthetic`, `gen_method`, `parent_id`, `split` | See [common metadata](#common-metadata-columns) |

---

## 2. `spam_ham_100k.csv` (binary)

100,000 rows: 50,000 spam and 50,000 ham. 3 columns:

| column | values |
|---|---|
| `message` | Message text |
| `label` | `1` = spam, `0` = ham |
| `spam_type` | `fraud`, `solicitation` or `ham`. This is an older, coarser 2-way scam type assigned by keyword rules. It is superseded by `scam_categories_100k.csv`. |

`spam_ham_100k_full.csv` adds `id` and the [common metadata](#common-metadata-columns) columns. These are the same 100k messages as the scam-category dataset, just labeled differently.

---

## 3. `unified_spam_dataset.csv` (real data only, first pass)

32,416 real messages (15,584 spam, 16,832 ham) with exact duplicates removed. It has no near-duplicate removal, no text cleaning and no synthetic rows. Columns: `message`, `label` (1/0), `spam_type` (fraud/solicitation/ham). `unified_spam_dataset_with_source.csv` adds a `source` column. This file is kept for reference. Use the cleaned 100k files for training.

---

## 4. Potential Threat synthetic data (label 8)

**Update (2026-11-08):** label 8 is now in `scam_categories.csv` as **Threats & Extortion**, and `classifier/build_splits.py` merges these files into training. The paragraphs below describe the files as they were first added.

Threat, coercion and fake-emergency extortion texts, for example "MOM IM DYING RIGHT NOW GIVE ME $900 OR I EXPLODE" or "YOUR WIFFE IS IN DANGER GIVE ME 500$". The 100k files have almost none: kidnap/ransom words appear in 86 rows (mostly Enron spam noise in labels 5 and 7), "or else / I know where you live" in 34 (mostly eBay phishing and ham), no short ALL-CAPS text contains a money amount, and 215 of 239 short ALL-CAPS texts are ham. **Proposal, not agreed:** label 8 is not in `scam_categories.csv` yet, and the 100k files are unchanged. Plan: [`docs/features/potential-threat-data.md`](../docs/features/potential-threat-data.md).

| file | rows | use |
|---|---|---|
| `potential_threat_synthetic.csv` | 4,100: 2,650 label 8, 1,450 label 0 | Extra **training** rows. All `split = train`. |
| `potential_threat_eval.csv` | 100: 58 label 8, 42 label 0 | Held-out check for the new class. `split = threat_eval`, so `train.py` ignores it. **Never train on it.** It includes Tuan's two examples. |
| `build_threat_synthetic.py` | | Generator. Stdlib only, fixed seed, `python3 -I data/build_threat_synthetic.py [out_dir]`. Two runs give byte-identical files. |

**Columns:** the same as `scam_categories_100k_full.csv`, plus `scenario`. Values: `label_class` 8 (`category_name` "Potential Threat", `is_spam` 1, `ftc_subcategory` -1, `label_method` `template`) or 0 (`Ham`, `is_spam` 0, `label_method` `ham`); `style` `sms`; `is_synthetic` True; `parent_id` empty; `label_confidence` 1.0. Training rows have `source` `synthetic_threat`, `gen_method` `template`; eval rows have `source` `synthetic_threat_eval`, `gen_method` `handwritten`, `label_method` `manual`. Ids start with `s` and are a hash of the text.

**Scenarios** (`scenario` column):

| label 8 | rows | | label 0 (hard negatives) | rows |
|---|---|---|---|---|
| `family_emergency` ("mom its me, they will kill me") | 450 | | `urgent_family` ("MOM CALL ME ASAP", "dad im at the hospital, broke my arm, can you pick me up") | 500 |
| `loved_one_danger` ("YOUR WIFE IS IN DANGER") | 450 | | `casual_money` ("can you venmo me $20 for pizza lol", rent, bills) | 450 |
| `kidnap_ransom` | 400 | | `harmless_slang` ("im dying lol", "this traffic is killing me") | 300 |
| `physical_threat` ("pay or we break your legs") | 400 | | `caps_excitement` ("MOM I GOT THE JOB") | 200 |
| `blackmail` (non-explicit: photos, chats, "your secret") | 350 | | | |
| `hitman_stalker` ("I know where you live") | 300 | | | |
| `self_harm_coercion` ("GIVE ME $900 OR I EXPLODE") | 300 | | | |

**Method:** slot-filled templates (relatives, loved ones, names, amounts as `$900` / `900$` / `900 dollars` / `$2,500` / `2.5k`, payment rails: gift cards, Zelle, Cash App, Venmo, Bitcoin/USDT, Western Union, wire, MoneyGram; urgency and "don't call the police" phrases), then the **same** noise for both labels: ALL CAPS / lowercase / as written, SMS slang, typos (letter doubling as in "WIFFE", dropped or swapped letters, common misspellings), punctuation and emojis. Hard negatives get the same caps and typo rates so caps alone can't predict the label: label 8 is 34% ALL CAPS, label 0 is 38%. Rows are deduplicated case- and punctuation-insensitively, never repeat an eval row, and none match a row in the 100k files.

**Caveats:**

- **Template-generated.** Like the other template rows (AUC ≈ 0.997 for telling them from real data), these are easy to recognize and may teach surface patterns (the template phrases, the emoji pools) rather than the idea of a threat. Judge the class on `potential_threat_eval.csv` and on real messages, not on the training rows.
- **Money is a strong cue.** 98% of label 8 rows and 32% of label 0 rows contain an amount. A threat without a money demand ("i know where you live") is mostly not covered.
- **The eval file is small and written by the same author** as the templates (an AI agent, in a different hand-written style), so it overstates real-world accuracy. Real threat messages would be a better test.
- **Self-harm coercion:** rows in that scenario all demand money. A real person in distress who also asks for money could be flagged. Blocking such a message is a worse error than delivering it, so the gateway may want to warn instead of block for this class (TBD).
- **Not in any 100k file and not read by `train.py` yet.** Training on it needs `train.py` changes; see the plan.

---

## 5. Harmless "free" texts (label 0)

**Why (Tuan, 2026-11-08):** the model was overfitting on the word "free" and flagging everyday texts such as "Feel free to do this" or "Free pizza". In `scam_categories_100k_full.csv`, "free" appears in about 5,800 scam rows and only about 2,100 ham rows.

| file | rows | use |
|---|---|---|
| `free_ham_synthetic.csv` | 300, all label 0 | Extra **training** rows (`split = train`). `classifier/build_splits.py` merges them with the threat rows, so 15% of each scenario goes to val (255 train / 45 val). |
| `build_free_ham_synthetic.py` | | Generator. Stdlib only, fixed seed, `python3 -I data/build_free_ham_synthetic.py [out_dir]`. Two runs give byte-identical files. |

**Columns:** the same as `potential_threat_synthetic.csv`: `label_class` 0, `category_name` Ham, `is_spam` 0, `label_method` `ham`, `source` `synthetic_free_ham`, `gen_method` `template`, `style` `sms`, `is_synthetic` True.

**Scenarios:** `feel_free` (80, "feel free to call me anytime"), `free_time` (70, "are you free tonight?"), `free_food_event` (60, "free pizza in the break room"), `free_everyday` (50, "parking is free after 6", "shipping was free"), `free_idiom` (40, "gluten free", "hands free", "free throw").

**Method:** slot-filled templates (names, family words, times, foods, places, events), then light styling: openers and closers ("hey", "lmk", "love you"), punctuation, emojis, and 14% ALL CAPS so caps plus "free" doesn't read as spam either. No row has a link, a phone number, a prize, a "claim/reply/call now" call to action or a money request. Rows are deduplicated case- and punctuation-insensitively and never repeat a row in `scam_categories_100k.csv` or the threat files.

**Caveats:** template-generated, so easy to recognize; 300 rows is small next to the ~5,800 scam rows with "free", so it may soften the cue without removing it. There's no held-out "free" ham check yet. Retrain to take effect.

---

## Where the data comes from

| `source` value | origin | style |
|---|---|---|
| `sms_spam_collection` | UCI SMS Spam Collection (`spam.csv`) | SMS, UK, cased |
| `ph_sms_spam` | Philippine reported spam/scam SMS (`spam1.csv`). Every row is labeled spam. Names are pre-masked as `<REAL NAME>`. Includes Tagalog. | SMS |
| `enron_1`…`enron_6` | Enron-Spam corpus via the Kaggle `haldonmez/spam-or-ham` mirror. Set 3 is missing because it was a git-lfs placeholder. | email: lowercase, punctuation removed, starts with `subject` |
| `synthetic` | Generated rows (see below) | either |

## Cleaning (real rows)

34,799 raw rows were reduced to **31,544** cleaned real rows. All of them are included in the 100k files.

- **Dropped:** `spam2.csv`, which is the same SMS corpus re-encoded.
- **Text normalized:** Unicode NFKC, HTML entities and tags, control characters, replacement-character runs.
- **Removed 68** junk or placeholder rows (`#ERROR!`, `<<Content not supported.>>`, empty emails).
- **Removed 45** rows that were mostly garbled characters.
- **Removed 15** emails longer than 20,000 characters.
- **Removed 3,127** exact and near duplicates (compared case- and punctuation-insensitively).

## Synthetic rows

68,456 rows (about 68%) are synthetic. They were added to reach 50k/50k spam vs ham and were all generated locally:

- `gen_method = augment`: a real training message with small edits (synonym swaps, word deletion or swapping, SMS slang, new phone numbers, URLs and amounts). Each real message is used at most 3 times, and `parent_id` points to the original.
- `gen_method = template`: built from phrase templates, then formatted to match the source style.

Template rows are easy to tell apart from real ones (a simple classifier separates them with AUC ≈ 0.997). Augmented rows are close to indistinguishable (AUC ≈ 0.58).

## Common metadata columns

| column | meaning |
|---|---|
| `source` | See the sources table above |
| `style` | `sms` or `email` |
| `is_synthetic` | True for generated rows |
| `gen_method` | `original`, `augment` or `template` |
| `parent_id` | For augmented rows, the `id` of the real message they were derived from |
| `split` | `train` / `val` / `test`, a stratified 80/10/10 split of the **real** rows. All synthetic rows are in `train`, and augmented rows only derive from train messages, so **val and test (3,155 rows each) are 100% real with no leakage**. Report metrics on these. |

## Caveats

- **Labels are rule-derived:** both `spam_type` and the 0–7 categories come from keyword rules plus a classifier trained on them, not from human annotation. About 45% of scam-category labels are `model`-assigned. Filter on `label_confidence` if you want cleaner labels.
- **Known errors:** bounced "mail delivery failure" emails tend to land in Imposter & Phishing. A few 419 letters ended up in Shopping, and a few software ads in Imposter.
- **Style differs by source:** Enron emails are lowercased with no punctuation, while SMS keeps its original formatting.
- **PH data:** a few rows in `ph_sms_spam` look like genuine bank advisories but are still labeled spam.

## Baseline (spam vs ham, TF-IDF + logistic regression, real test split)

| training data | binary F1 |
|---|---|
| real rows only | 0.981 |
| real + synthetic | 0.981 |

## Rebuilding

The raw sources live outside this repo (originally `~/Downloads/scam_data`).

```bash
python3 -I build_100k.py <raw_data_dir> <out_dir>   # cleans data -> spam_ham_100k*.csv
python3 -I recategorize.py <dir_with_spam_ham_100k_full.csv_and_ftc_taxonomy.py>   # -> scam_categories_100k*.csv
```

`ftc_taxonomy.py` contains the FTC category list and the keyword rules. Both scripts use fixed random seeds.
