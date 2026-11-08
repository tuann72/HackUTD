# Message bank

Labeled example messages and scripted scenarios for the perpetrator simulator (`services/perpetrator-sim/`). They make demos repeatable and let the team check that the gateway blocks scams and delivers legitimate messages.

This is **demo input, not training data**. The classifier trains on `data/scam_categories_100k_full.csv` (see `AGENTS.md`).

## Files

| File | What it is |
|---|---|
| `bank.jsonl` | 91 real messages sampled from the dataset's `test` split (`style == sms` only) |
| `generated.jsonl` | 27 hand-written SMS-style messages for categories the test split lacks, plus some legit texts |
| `scenarios/grandparent.jsonl` | The main demo story (5 steps, about 25 s) |
| `scenarios/smoke.jsonl` | 3 quick messages, 500 ms apart, for smoke tests |
| `scenarios/imessage-demo.jsonl` | The iMessage demo (10 steps, about 80 s): family texts, a group-chat album and a reaction, the grandparent scam, a scammer's photo, a phishing link, a fake "Bank Fraud Dept" contact card and a final bank scam. See [`docs/DEMO.md`](../../docs/DEMO.md) |
| `rapid.jsonl` | 200 hand-written complete sentences for the web panel's **Rapid fire** button: 80 scams (40%) across the scam groups, 120 ordinary texts. Rapid fire draws only from this file; the other buttons and the CLI simulator use `bank.jsonl` and `generated.jsonl` |
| `build_bank.py` | Rebuilds `bank.jsonl` from the CSV |
| `build_rapid.py` | Writes `rapid.jsonl` from the messages listed in it (`python3 -I data/message_bank/build_rapid.py`), checking the 200 / 80 counts and that each text is a full sentence |

## Fields

`bank.jsonl` and `generated.jsonl`, one JSON object per line:

| Field | Meaning |
|---|---|
| `id` | `bank-NNN` or `gen-NNN` |
| `text` | Message body (whitespace collapsed) |
| `expected_label` | `scam` or `legit` |
| `category` | Scam group name from `data/scam_categories.csv`, or `null` for legit |
| `source` | `dataset_test` or `generated` |
| `source_id` | The row `id` in `scam_categories_100k_full.csv`, or `null` for generated rows |

Scenario files, one step per line:

| Field | Meaning |
|---|---|
| `delayMs` | Wait before this step, relative to the previous step |
| `from` | Fictional sender, `+15555550101` to `+15555550199` |
| `body` | Message text. Omit it when `content` is given |
| `content` | Optional non-text iMessage content (see below). Replaces `body` |
| `group` | Optional group chat id, e.g. `"family-chat"`. The message arrives in that group (`space.type: "group"`) instead of a DM |
| `expected` | `deliver` or `block`. Content with no text (attachment, reaction, contact card) is always `deliver`, shown as "Not checked" |

`content` follows Photon's inbound `message.content` shapes. It's metadata only: no files are sent.

| `content.type` | Fields | Example |
|---|---|---|
| `text` | `text` | `{"type": "text", "text": "hi"}` (same as `body`; used inside albums) |
| `richlink` | `url` | `{"type": "richlink", "url": "https://bit.ly/acct-verify"}` |
| `attachment` | `name`, optional `mimeType` (guessed from the extension) and `size` | `{"type": "attachment", "name": "IMG_1.HEIC", "size": 2483112}` |
| `reaction` | `emoji`, optional `targetPreview` (the message reacted to, max 80 chars) | `{"type": "reaction", "emoji": "❤️", "targetPreview": "See you!"}` |
| `contact` | optional `name`, `phones` (fictional `+1555…` unless `--allow-real-numbers`) | `{"type": "contact", "name": "Bank Fraud Dept", "phones": ["+15555550199"]}` |
| `group` | `items`: `text`, `richlink` or `attachment` blocks (an album) | `{"type": "group", "items": [{"type": "text", "text": "Lake!"}, {"type": "attachment", "name": "a.jpg"}]}` |

## How `bank.jsonl` was built

```bash
python3 -I data/message_bank/build_bank.py
```

Stdlib only (`csv`, `json`, `random`). It keeps rows with `split == "test"` and `style == "sms"` (real messages the classifier never trains on), sorts each class by `id`, and samples with a fixed seed (`20261107`): 40 ham rows and up to 15 rows per scam category. Re-running gives the same file.

Counts in `bank.jsonl` (2026-11-07):

| Category | Rows | Available in test/sms |
|---|---|---|
| Ham (legit) | 40 | 450 |
| Imposter & Phishing | 15 | 15 |
| Prizes, Lotteries & Advance-Fee | 15 | 19 |
| Internet, Telecom & Media | 15 | 117 |
| Shopping & Product Offers | 3 | 3 |
| Jobs, Business & Investment | 2 | 2 |
| Health & Pharmacy | 1 | 1 |
| Loans, Credit & Debt | 0 | 0 |

Counts in `generated.jsonl`: Imposter & Phishing 8 (grandparent/family emergency, bank, courier, tax), Loans, Credit & Debt 3, Health & Pharmacy 3, Jobs, Business & Investment 3, Shopping & Product Offers 2, Prizes 1, legit 7 (pharmacy, family, appointments, a 2FA code).

## Caveats

- **Labels are machine-assigned** (keyword rules plus a classifier), not human-annotated. Some `bank.jsonl` labels may be wrong.
- **Don't tune block thresholds on these rows.** `bank.jsonl` comes from the `test` split; tuning on it makes the reported test metrics dishonest. Tune on `val`.
- **`expected` / `expected_label` are for checking only.** The simulator never sends them; the gateway never sees them.
- Many real scam rows come from Philippine SMS sources (peso amounts, local banks and wallets, some Tagalog), so they may not read as US texts. They contain real scam links and brand names: don't open the links.
- Group chat ids and attachment names in scenarios are made up. Attachments carry no file.
- Generated rows use fictional brands and `bit.ly/...` or `example.com` links, and no real people.
