"""Collapse the 28 FTC Consumer Sentinel categories into 7 scam groups and relabel the 100k dataset.

Usage: python3 -I recategorize.py <dir containing spam_ham_100k_full.csv and ftc_taxonomy.py>
"""
import os, sys
import numpy as np, pandas as pd, scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

d = sys.argv[1]
sys.path.insert(0, d)
from ftc_taxonomy import CATEGORIES, score, PRI

GROUPS = {
    0: ("Ham", "Legitimate, non-spam message", []),
    1: ("Imposter & Phishing", "Pretends to be a bank, wallet, courier, agency, tax office, debt collector, tech support, "
        "charity or relative to steal money or credentials; includes malware/security scares", [7, 22, 15, 23, 27, 3]),
    2: ("Prizes, Lotteries & Advance-Fee", "Fake winnings, sweepstakes, 419 inheritance/foreign-money letters, fake checks, "
        "and 'free grant' offers that require a fee first", [14, 4, 5]),
    3: ("Jobs, Business & Investment", "Work-from-home, task/job scams, MLM and business opportunities, stock pump-and-dump, "
        "crypto and guaranteed-return investments", [2, 9]),
    4: ("Loans, Credit & Debt", "Loan and payday offers, mortgage refinance, debt relief, credit repair, credit reports, "
        "advance-fee credit", [1, 11, 19, 21]),
    5: ("Health & Pharmacy", "Online pharmacy, pills, weight loss, supplements, enhancement products, miracle cures", [6]),
    6: ("Shopping & Product Offers", "Retail promos, replicas, software, electronics, office supplies, cars/warranties, "
        "home and real estate, travel, magazines, education, funeral plans", [13, 20, 12, 18, 26, 17, 10, 24, 25]),
    7: ("Internet, Telecom & Media", "Online gambling, adult/dating sites, SEO and bulk-email marketing, premium SMS, "
        "ringtones, phone plans, TV/streaming/music offers", [8, 16, 28]),
}
FTC2G = {f: g for g, (_, _, fs) in GROUPS.items() for f in fs}
assert sorted(FTC2G) == list(range(1, 29)), "every FTC category must map to exactly one group"

def group_scores(text):
    s, h = score(text)
    gs, gh, gbest = {}, {}, {}
    for f, v in s.items():
        g = FTC2G[f]
        if v > gs.get(g, -1) or (v == gs.get(g) and PRI[f] < PRI[gbest[g]]):
            gs[g], gh[g], gbest[g] = v, h[f], f
    return gs, gh, gbest

def rule_label(text):
    gs, gh, gbest = group_scores(text)
    ranked = sorted(gs, key=lambda g: -gs[g])
    b, s2 = ranked[0], gs[ranked[1]]
    if gs[b] == 0:
        return None, None, False
    conf = gs[b] >= 3 and gs[b] - s2 >= 2 and (gh[b] >= 2 or len(text) < 300)
    return b, gbest[b], conf

df = pd.read_csv(os.path.join(d, "spam_ham_100k_full.csv"))
spam = df.label == 1
r = df.loc[spam, "message"].map(rule_label)
df["group"] = 0; df["ftc_subcategory"] = 0; df["label_method"] = "ham"
df.loc[spam, "group"] = r.str[0]; df.loc[spam, "ftc_subcategory"] = r.str[1]
conf = pd.Series(False, index=df.index, dtype=bool)
conf.loc[r.index] = np.array([bool(x[2]) for x in r], dtype=bool)
df.loc[spam & conf, "label_method"] = "rule"

# fallback classifier: trained on confidently rule-labeled TRAIN-split spam, applied to all uncertain spam
tr = df[spam & conf & (df.split == "train")]
w = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=300_000, sublinear_tf=True)
c = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=3, max_features=300_000, sublinear_tf=True)
X = sp.hstack([w.fit_transform(tr.message), c.fit_transform(tr.message)]).tocsr()
clf = LogisticRegression(max_iter=3000, C=5, class_weight="balanced").fit(X, tr.group.astype(int))
unc = df[spam & ~conf]
Xu = sp.hstack([w.transform(unc.message), c.transform(unc.message)]).tocsr()
proba = clf.predict_proba(Xu)
df.loc[unc.index, "group"] = clf.classes_[proba.argmax(1)]
df.loc[unc.index, "label_method"] = "model"
df["label_confidence"] = 1.0
df.loc[unc.index, "label_confidence"] = proba.max(1).round(3)
# keep the FTC subcategory only where it agrees with the final group
df["ftc_subcategory"] = [int(f) if (isinstance(f, (int, float)) and f == f and f and FTC2G[int(f)] == g) else (0 if g == 0 else -1)
                         for f, g in zip(df.ftc_subcategory, df.group)]
df["group"] = df.group.astype(int)

df["category_name"] = df.group.map(lambda g: GROUPS[g][0])
out = df.rename(columns={"group": "label_class"})
out[["message", "label_class"]].rename(columns={"label_class": "label"}).to_csv(os.path.join(d, "scam_categories_100k.csv"), index=False)
cols = ["id", "message", "label_class", "category_name", "ftc_subcategory", "label_method", "label_confidence",
        "label", "source", "style", "is_synthetic", "gen_method", "parent_id", "split"]
out[cols].rename(columns={"label": "is_spam"}).to_csv(os.path.join(d, "scam_categories_100k_full.csv"), index=False)
pd.DataFrame([{"label": g, "name": n, "description": desc,
               "ftc_categories": "; ".join(f"{f} {CATEGORIES[f][0]}" for f in fs)} for g, (n, desc, fs) in GROUPS.items()]
             ).to_csv(os.path.join(d, "scam_categories.csv"), index=False)

t = pd.crosstab(df.category_name, df.label_method, margins=True)
t["real"] = df[~df.is_synthetic].category_name.value_counts()
print(t.to_string())
print("\nmodel-labeled confidence: median", np.median(proba.max(1)).round(3), " share < 0.5:", (proba.max(1) < 0.5).mean().round(3))
