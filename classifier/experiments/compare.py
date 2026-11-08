"""Compare TF-IDF+LR, MiniLM+LR, and ways of combining them. Tune on val, report on test.

Usage: python compare.py <repo_root> <runs_dir>
Setup (from the repo root, on a machine with a CUDA GPU for MiniLM):
    python classifier/train.py --model tfidf  --out <runs>/tfidf-category
    python classifier/train.py --model minilm --out <runs>/minilm-category
Results recorded in CHANGELOG.md, "TF-IDF vs. MiniLM, combined flows and zero-day test".
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score, brier_score_loss,
                             f1_score, precision_recall_curve, precision_recall_fscore_support)

repo, runs = Path(sys.argv[1]), Path(sys.argv[2])
df = pd.read_csv(repo / "data" / "scam_categories_100k_full.csv",
                 usecols=["message", "label_class", "split", "style"])
df = df[df.split.isin(["val", "test"])].reset_index(drop=True)
df["message"] = df["message"].fillna("").astype(str)
texts = df.message.tolist()

# --- class probabilities from each trained model ---
tf_vec = joblib.load(runs / "tfidf-category" / "vectorizer.joblib")
tf_clf = joblib.load(runs / "tfidf-category" / "head.joblib")
P_tf = tf_clf.predict_proba(tf_vec.transform(texts))

from sentence_transformers import SentenceTransformer
enc = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cuda")
E = enc.encode(texts, batch_size=128, normalize_embeddings=True, convert_to_numpy=True)
mn_clf = joblib.load(runs / "minilm-category" / "head.joblib")
P_mn = mn_clf.predict_proba(E)
assert list(tf_clf.classes_) == list(mn_clf.classes_) == list(range(8))

y = df.label_class.to_numpy()
is_val, is_test = (df.split == "val").to_numpy(), (df.split == "test").to_numpy()
sms = (df["style"] == "sms").to_numpy()


def scam_prob(P):
    return 1.0 - P[:, 0]


def ece(y_true, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    return sum(abs(p[idx == b].mean() - y_true[idx == b].mean()) * (idx == b).mean()
               for b in range(bins) if (idx == b).any())


def thr_for_precision(y_true, p, target=0.97):
    prec, rec, thr = precision_recall_curve(y_true, p)
    ok = np.where(prec[:-1] >= target)[0]
    return float(thr[ok[0]]) if len(ok) else 0.5


def evaluate(name, P, note=""):
    """P: 8-class probabilities for all rows. Threshold for the 97%-precision point picked on val."""
    s = scam_prob(P)
    yb = (y != 0).astype(int)
    t97 = thr_for_precision(yb[is_val], s[is_val])
    m = is_test
    pred_cls = P.argmax(1)
    p5, r5, f5, _ = precision_recall_fscore_support(yb[m], s[m] >= 0.5, average="binary")
    p97, r97, _, _ = precision_recall_fscore_support(yb[m], s[m] >= t97, average="binary")
    sm = m & sms
    row = dict(setup=name, P=p5, R=r5, F1=f5,
               FP=int(((s[m] >= 0.5) & (yb[m] == 0)).sum()),
               FN=int(((s[m] < 0.5) & (yb[m] == 1)).sum()),
               PR_AUC=average_precision_score(yb[m], s[m]),
               thr97=t97, P_at97=p97, R_at97=r97,
               SMS_F1=f1_score(yb[sm], s[sm] >= 0.5),
               cat_acc=accuracy_score(y[m], pred_cls[m]),
               cat_macroF1=f1_score(y[m], pred_cls[m], average="macro"),
               brier=brier_score_loss(yb[m], s[m]), ECE=ece(yb[m], s[m]), note=note)
    return row


rows = [evaluate("TF-IDF + LR", P_tf), evaluate("MiniLM + LR", P_mn)]

# Weighted average: weight on TF-IDF tuned on val (maximize PR-AUC).
yb = (y != 0).astype(int)
best_w = max(np.linspace(0, 1, 21),
             key=lambda w: average_precision_score(yb[is_val], scam_prob(w * P_tf + (1 - w) * P_mn)[is_val]))
rows.append(evaluate("Average", best_w * P_tf + (1 - best_w) * P_mn, f"w_tfidf={best_w:.2f}"))

# Stacking: multinomial LR on both models' 16 log-probabilities, trained on val.
Z = np.hstack([np.log(P_tf + 1e-9), np.log(P_mn + 1e-9)])
stack = LogisticRegression(max_iter=5000, C=1.0).fit(Z[is_val], y[is_val])
Zt = np.log(P_tf + 1e-9)
cal = LogisticRegression(max_iter=5000, C=1.0).fit(Zt[is_val], y[is_val])
rows.append(evaluate("TF-IDF recalibrated", cal.predict_proba(Zt), "TF-IDF only, refit on val"))
rows.append(evaluate("Stacked LR", stack.predict_proba(Z), "trained on val"))

# Cascade: TF-IDF decides when confident; borderline rows (lo <= s < hi) use the average instead.
s_tf = scam_prob(P_tf)
P_avg = best_w * P_tf + (1 - best_w) * P_mn
best = None
for lo in np.arange(0.05, 0.5, 0.05):
    for hi in np.arange(0.55, 1.0, 0.05):
        band = (s_tf >= lo) & (s_tf < hi)
        P_c = np.where(band[:, None], P_avg, P_tf)
        f = f1_score(yb[is_val], scam_prob(P_c)[is_val] >= 0.5)
        if best is None or f > best[0]:
            best = (f, lo, hi)
_, lo, hi = best
band = (s_tf >= lo) & (s_tf < hi)
P_casc = np.where(band[:, None], P_avg, P_tf)
rows.append(evaluate("Cascade", P_casc,
                     f"band [{lo:.2f},{hi:.2f}) -> {band[is_test].mean():.1%} of test sent to MiniLM"))

# Where do they disagree? How often is MiniLM right when TF-IDF is wrong (binary, test)?
tf_ok = (s_tf >= 0.5) == yb.astype(bool)
mn_ok = (scam_prob(P_mn) >= 0.5) == yb.astype(bool)
dis = dict(tfidf_wrong=int((~tf_ok & is_test).sum()),
           minilm_right_when_tfidf_wrong=int((~tf_ok & mn_ok & is_test).sum()),
           minilm_wrong_when_tfidf_right=int((tf_ok & ~mn_ok & is_test).sum()))

out = pd.DataFrame(rows)
pd.set_option("display.width", 250, "display.max_columns", 30, "display.max_colwidth", 60)
print(out.round(4).to_string(index=False))
print(dis)
(runs / "comparison.json").write_text(json.dumps({"rows": rows, "disagreement": dis}, indent=2, default=float))
