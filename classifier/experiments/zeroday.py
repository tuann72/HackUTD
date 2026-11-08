"""Zero-day test: hold out one whole scam category from training, see who still catches it.

For each scam category k (1..7):
  - train binary scam/ham models on the train split WITHOUT any category-k rows
    (TF-IDF vocabulary is also fit without them)
  - combine them the same ways as compare.py; anything fit on val also excludes category k
  - on test, report recall on category k (never seen), recall on the other scams, and false blocks on ham
Thresholds: 0.5, and the 97%-precision threshold tuned on val minus category k.

Usage: python zeroday.py <repo_root> <out_dir>
Setup (from the repo root, on a machine with a CUDA GPU for MiniLM):
    python classifier/train.py --model tfidf  --out <runs>/tfidf-category
    python classifier/train.py --model minilm --out <runs>/minilm-category
Results recorded in CHANGELOG.md, "TF-IDF vs. MiniLM, combined flows and zero-day test".
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_curve

repo, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
df = pd.read_csv(repo / "data" / "scam_categories_100k_full.csv", usecols=["message", "label_class", "split"])
df["message"] = df["message"].fillna("").astype(str)
texts = np.array(df.message.tolist(), dtype=object)
y = df.label_class.to_numpy()
yb = (y != 0).astype(int)
split = df.split.to_numpy()
is_train, is_val, is_test = split == "train", split == "val", split == "test"
names = pd.read_csv(repo / "data" / "scam_categories.csv").sort_values("label")["name"].tolist()

# MiniLM embeddings once for every row (cached).
emb_path = out / "minilm_embeddings.npy"
if emb_path.exists():
    E = np.load(emb_path)
else:
    from sentence_transformers import SentenceTransformer
    enc = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cuda")
    E = enc.encode(list(texts), batch_size=256, normalize_embeddings=True, convert_to_numpy=True,
                   show_progress_bar=True)
    np.save(emb_path, E)
print("embeddings", E.shape, flush=True)

W_TFIDF, BAND = 0.80, (0.05, 0.60)  # fixed from compare.py, not re-tuned per hold-out


def tfidf_scores(k):
    tr = is_train & (y != k)
    vec = TfidfVectorizer(lowercase=True, token_pattern=r"(?u)\b\w\w+\b", ngram_range=(1, 2), min_df=2,
                          max_df=0.9, sublinear_tf=True, max_features=300_000)
    vec.fit(texts[tr])
    clf = LogisticRegression(max_iter=3000, class_weight="balanced", C=8.0)
    clf.fit(vec.transform(texts[tr]), yb[tr])
    ev = is_val | is_test
    s = np.full(len(y), np.nan)
    s[ev] = clf.predict_proba(vec.transform(texts[ev]))[:, 1]
    print(f"tfidf hold-out {k} done", flush=True)
    return k, s


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def thr97(s, mask):
    prec, _, thr = precision_recall_curve(yb[mask], s[mask])
    ok = np.where(prec[:-1] >= 0.97)[0]
    return float(thr[ok[0]]) if len(ok) else 0.5


tf_all = dict(Parallel(n_jobs=4)(delayed(tfidf_scores)(k) for k in range(1, 8)))

rows = []
for k in range(1, 8):
    tr = is_train & (y != k)
    mn = LogisticRegression(max_iter=3000, class_weight="balanced", C=4.0).fit(E[tr], yb[tr])
    s_mn = np.full(len(y), np.nan)
    ev = is_val | is_test
    s_mn[ev] = mn.predict_proba(E[ev])[:, 1]
    s_tf = tf_all[k]
    val_k = is_val & (y != k)  # val without the held-out category, for anything fit or tuned on val

    setups = {"TF-IDF": s_tf, "MiniLM": s_mn, "Average": W_TFIDF * s_tf + (1 - W_TFIDF) * s_mn}
    band = (s_tf >= BAND[0]) & (s_tf < BAND[1])
    setups["Cascade"] = np.where(band, setups["Average"], s_tf)
    rc = LogisticRegression().fit(logit(s_tf[val_k])[:, None], yb[val_k])
    setups["TF-IDF recal"] = np.where(ev, rc.predict_proba(np.nan_to_num(logit(s_tf))[:, None])[:, 1], np.nan)
    Z = np.c_[logit(s_tf), logit(s_mn)]
    st = LogisticRegression().fit(Z[val_k], yb[val_k])
    setups["Stacked"] = np.where(ev, st.predict_proba(np.nan_to_num(Z))[:, 1], np.nan)

    held = is_test & (y == k)
    other = is_test & (y != 0) & (y != k)
    ham = is_test & (y == 0)
    for name, s in setups.items():
        t = thr97(s, val_k)
        rows.append(dict(held_out=names[k], n_held=int(held.sum()), setup=name,
                         recall_held_05=float((s[held] >= 0.5).mean()),
                         recall_held_97=float((s[held] >= t).mean()),
                         recall_other_05=float((s[other] >= 0.5).mean()),
                         false_block_rate_05=float((s[ham] >= 0.5).mean()),
                         thr97=t))
    print(f"hold-out {k} ({names[k]}) done", flush=True)

res = pd.DataFrame(rows)
res.to_csv(out / "zeroday.csv", index=False)
pd.set_option("display.width", 250, "display.max_columns", 20)
print(res.round(3).to_string(index=False))

# Summary: average over the 7 hold-outs, and weighted by test size of each held-out category.
g = res.groupby("setup")
summary = pd.DataFrame({
    "recall_held_05_mean": g.recall_held_05.mean(),
    "recall_held_05_weighted": g.apply(lambda d: np.average(d.recall_held_05, weights=d.n_held)),
    "recall_held_97_mean": g.recall_held_97.mean(),
    "recall_held_97_weighted": g.apply(lambda d: np.average(d.recall_held_97, weights=d.n_held)),
    "recall_other_05_mean": g.recall_other_05.mean(),
    "false_block_rate_05_mean": g.false_block_rate_05.mean(),
}).sort_values("recall_held_97_weighted", ascending=False)
print("\nSUMMARY")
print(summary.round(3).to_string())
(out / "zeroday_summary.json").write_text(summary.round(4).to_json(orient="index", indent=2))
