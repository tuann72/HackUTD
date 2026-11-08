"""Build data/message_bank/bank.jsonl from the real test split.

Selects only rows with split == "test" and style == "sms" from
data/scam_categories_100k_full.csv (real messages, never used for training),
then takes a deterministic sample: HAM_COUNT ham rows plus up to
PER_CATEGORY rows for each scam category.

Run from anywhere (stdlib only; pandas is not needed):
    python3 -I data/message_bank/build_bank.py
"""

import csv
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

SEED = 20261107
HAM_COUNT = 40
PER_CATEGORY = 15

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "scam_categories_100k_full.csv"
OUT = HERE / "bank.jsonl"


def main() -> None:
    csv.field_size_limit(sys.maxsize)
    groups: dict[str, list[dict]] = defaultdict(list)
    with SOURCE.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["split"] != "test" or row["style"] != "sms":
                continue
            text = " ".join(row["message"].split())
            if not text:
                continue
            groups[row["label_class"]].append({**row, "message": text})

    rng = random.Random(SEED)
    picked: list[dict] = []
    for label in sorted(groups, key=int):
        rows = sorted(groups[label], key=lambda r: r["id"])
        k = HAM_COUNT if label == "0" else PER_CATEGORY
        picked.extend(rng.sample(rows, min(k, len(rows))))

    counts: Counter = Counter()
    with OUT.open("w", encoding="utf-8") as out:
        for i, row in enumerate(picked, start=1):
            is_ham = row["label_class"] == "0"
            rec = {
                "id": f"bank-{i:03d}",
                "text": row["message"],
                "expected_label": "legit" if is_ham else "scam",
                "category": None if is_ham else row["category_name"],
                "source": "dataset_test",
                "source_id": row["id"],
            }
            counts[rec["category"] or "Ham"] += 1
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"wrote {len(picked)} rows to {OUT}")
    for name, n in counts.most_common():
        print(f"  {name}: {n}")


if __name__ == "__main__":
    main()
