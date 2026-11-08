"""Build leak-free train/val and test files, so training can't see the test set.

    python classifier/build_splits.py [--out classifier/splits]

Writes (gitignored; rerun any time, the output is deterministic):
    train_val.csv    what train.py reads
    test.csv         real messages, read only by evaluate.py
    threat_eval.csv  held-out threat check, read only by evaluate.py
    manifest.json    row counts and what was removed

Rules:
  * The existing real test split is the anchor. Its rows are only deduplicated.
  * Anything in train or val that matches a held-out message is removed: same text after
    normalizing case, punctuation and digits, or the same set of words in another order.
  * Synthetic rows made from a removed or held-out message are removed too (parent_id).
  * Threat rows are templates and exist only for train and val. 15% of each scenario goes to val,
    because the stacker is fit on val and the real val split has no threat messages.
    Test stays 100% real; threat rows never enter it.
  * The 600 government-threat, IRS, ID-request and health scam templates
    (data/gov_health_id_scam_synthetic.csv) are handled exactly like the threat rows: 15% of each
    scenario goes to val.
  * The 300 harmless "free" ham texts (data/free_ham_synthetic.csv) are already appended to
    scam_categories_100k_full.csv as train rows, so they arrive with the base file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
COLUMNS = ["id", "message", "label_class", "is_spam", "split", "style", "is_synthetic", "parent_id", "source"]
THREAT_VAL_SHARE = 0.15
MIN_BAG_TOKENS = 8  # shorter texts can share a word set by chance


def tokens(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9 ]+", " ", re.sub(r"\d+", "0", text.lower())).split()


def keys(text: str) -> tuple[str, str]:
    """(exact key, word-set key). The word-set key is empty for short texts."""
    toks = tokens(text)
    exact = hashlib.sha1(" ".join(toks).encode()).hexdigest()
    bag = hashlib.sha1(" ".join(sorted(set(toks))).encode()).hexdigest() if len(set(toks)) >= MIN_BAG_TOKENS else ""
    return exact, bag


def with_keys(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["message"] = df["message"].fillna("").astype(str)
    pairs = [keys(t) for t in df["message"]]
    df["_exact"] = [p[0] for p in pairs]
    df["_bag"] = [p[1] for p in pairs]
    return df


def _matches(df: pd.DataFrame, exact: set[str], bag: set[str]) -> pd.Series:
    return df["_exact"].isin(exact) | (df["_bag"].ne("") & df["_bag"].isin(bag))


def _dedupe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.drop_duplicates("_exact")
    return df[df["_bag"].eq("") | ~df["_bag"].duplicated()]


def clean_splits(base: pd.DataFrame, threats: pd.DataFrame, threat_eval: pd.DataFrame, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict]:
    """Returns (train_val, test, threat_eval, stats). All inputs need COLUMNS; threats also needs scenario."""
    base, threats, threat_eval = with_keys(base), with_keys(threats), with_keys(threat_eval)
    stats: dict = {"input": {s: int((base.split == s).sum()) for s in ("train", "val", "test")}}

    test = _dedupe(base[base.split == "test"])
    threat_eval = _dedupe(threat_eval)
    stats["test_internal_duplicates_removed"] = stats["input"]["test"] - len(test)

    held_exact = set(test["_exact"]) | set(threat_eval["_exact"])
    held_bag = (set(test["_bag"]) | set(threat_eval["_bag"])) - {""}

    # Validation rows: real val, then a held-out share of each template scenario (threats and the other template files).
    val = base[base.split == "val"]
    leaked = _matches(val, held_exact, held_bag)
    stats["val_removed_matching_held_out"] = int(leaked.sum())
    val = _dedupe(val[~leaked])

    threats = _dedupe(threats[~_matches(threats, held_exact, held_bag)])
    rng = np.random.default_rng(seed)
    to_val = np.zeros(len(threats), dtype=bool)
    for _, idx in threats.reset_index(drop=True).groupby(["label_class", "scenario"]).indices.items():
        to_val[rng.permutation(idx)[: int(round(len(idx) * THREAT_VAL_SHARE))]] = True
    threat_val, threat_train = threats[to_val], threats[~to_val]

    held_exact |= set(val["_exact"]) | set(threat_val["_exact"])
    held_bag |= (set(val["_bag"]) | set(threat_val["_bag"])) - {""}

    train = pd.concat([base[base.split == "train"], threat_train], ignore_index=True)
    before = len(train)
    leaked = _matches(train, held_exact, held_bag)
    stats["train_removed_matching_held_out"] = int(leaked.sum())
    gone_ids = set(train.loc[leaked, "id"]) | set(base.loc[base.split != "train", "id"])
    train = train[~leaked]
    orphan = train["parent_id"].isin(gone_ids) & train["parent_id"].notna()
    stats["train_removed_child_of_held_out"] = int(orphan.sum())
    train = train[~orphan]
    deduped = _dedupe(train)
    stats["train_internal_duplicates_removed"] = len(train) - len(deduped)
    train = deduped

    train = train.assign(split="train")
    val = val.assign(split="val")
    threat_val = threat_val.assign(split="val")
    train_val = pd.concat([train, val, threat_val], ignore_index=True)

    assert not set(train["_exact"]) & (set(val["_exact"]) | set(threat_val["_exact"]) | set(test["_exact"]) | set(threat_eval["_exact"]))
    assert not set(val["_exact"]) & set(test["_exact"])
    assert not test["is_synthetic"].any(), "the test split must be real messages only"
    stats["removed_from_train_total"] = before - len(train)
    stats["output"] = {
        "train": len(train),
        "val_real": len(val),
        "val_templates": len(threat_val),
        "test": len(test),
        "threat_eval": len(threat_eval),
    }
    stats["train_labels"] = {int(k): int(v) for k, v in train["label_class"].value_counts().sort_index().items()}
    drop = ["_exact", "_bag"]
    return train_val.drop(columns=drop), test.drop(columns=drop), threat_eval.drop(columns=drop), stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(REPO_ROOT / "data"))
    ap.add_argument("--out", default=str(REPO_ROOT / "classifier" / "splits"))
    args = ap.parse_args()
    data, out = Path(args.data_dir), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    base = pd.read_csv(data / "scam_categories_100k_full.csv", usecols=COLUMNS)
    # Template rows: split by scenario, 15% to val.
    threats = pd.concat([pd.read_csv(data / name, usecols=COLUMNS + ["scenario"])
                         for name in ("potential_threat_synthetic.csv", "gov_health_id_scam_synthetic.csv", "money_request_synthetic.csv", "official_ham_synthetic.csv")],
                        ignore_index=True)
    threat_eval = pd.read_csv(data / "potential_threat_eval.csv", usecols=COLUMNS + ["scenario"])
    train_val, test, held_threats, stats = clean_splits(base, threats, threat_eval)

    train_val.to_csv(out / "train_val.csv", index=False)
    test.to_csv(out / "test.csv", index=False)
    held_threats.to_csv(out / "threat_eval.csv", index=False)
    (out / "manifest.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
