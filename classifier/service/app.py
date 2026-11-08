"""T-Guard classifier inference service.

POST /classify  {"messageId": "...", "text": "..."}
             -> {"label", "score", "category", "model", "highlights"}
GET  /healthz

Serves whichever model `train.py` wrote to the artifacts dir (model.json "kind"):
    minilm-lr  MiniLM embeddings + LR; highlights by occlusion (drop a word, re-score)
    tfidf-lr   TF-IDF + LR; highlights straight from the coefficients (exact, no re-scoring)
    stacked-lr both of the above, combined by a small LR on their log-probabilities;
               highlights by occlusion through the whole stack (so they explain the real score)

Returns a verdict only. Block/deliver policy and thresholds live in the gateway.
Auth: `Authorization: Bearer $CLASSIFIER_TOKEN`. The service refuses to start without a token
unless CLASSIFIER_ALLOW_NO_AUTH=1 (local development only).
"""

from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path

import joblib
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ARTIFACTS = Path(os.environ.get("CLASSIFIER_ARTIFACTS", Path(__file__).resolve().parent.parent / "artifacts"))
TOKEN = os.environ.get("CLASSIFIER_TOKEN", "")
if not TOKEN and os.environ.get("CLASSIFIER_ALLOW_NO_AUTH") != "1":
    raise SystemExit("Set CLASSIFIER_TOKEN (or CLASSIFIER_ALLOW_NO_AUTH=1 for local development).")
MAX_HIGHLIGHT_WORDS = 60  # occlusion cost grows with word count; long texts only score the first N words
TOP_HIGHLIGHTS = 5  # distinct words to highlight
MAX_SPANS = 10  # a top word that repeats is highlighted at most this many times in total
STOPWORDS = set("a an the is are was were be to of in on at for and or but your you my me i we it this that with from by as our us".split())
TOKEN_PATTERN = re.compile(r"(?u)\b\w\w+\b")  # must match make_tfidf() in train.py

meta = json.loads((ARTIFACTS / "model.json").read_text())
KIND = meta.get("kind", "minilm-lr")  # artifacts from before "kind" existed are MiniLM
head = joblib.load(ARTIFACTS / "head.joblib")
label_names: list[str] = meta["label_names"]
classes = [int(c) for c in head.classes_]
ham_col = classes.index(0)

if KIND in ("minilm-lr", "stacked-lr"):
    from sentence_transformers import SentenceTransformer

    encoder = SentenceTransformer(meta["encoder"], device=os.environ.get("CLASSIFIER_DEVICE", "cpu"))

    def embed(texts: list[str]):
        return encoder.encode(texts, batch_size=64, normalize_embeddings=True, convert_to_numpy=True)

if KIND == "minilm-lr":
    featurize = embed

elif KIND == "stacked-lr":
    # head is the stacker; its input is both base models' class log-probabilities.
    vectorizer = joblib.load(ARTIFACTS / "vectorizer.joblib")
    tfidf_head = joblib.load(ARTIFACTS / "tfidf_head.joblib")
    minilm_head = joblib.load(ARTIFACTS / "minilm_head.joblib")
    STACK_EPS = float(meta["stack_eps"])
    if meta.get("stack_order") != ["tfidf", "minilm"]:
        raise SystemExit(f"Unexpected stack_order {meta.get('stack_order')!r} in model.json")

    def featurize(texts: list[str]):
        # Must match stack_features() in train.py.
        p_tf = tfidf_head.predict_proba(vectorizer.transform(texts))
        p_mn = minilm_head.predict_proba(embed(texts))
        return np.hstack([np.log(p_tf + STACK_EPS), np.log(p_mn + STACK_EPS)])

elif KIND == "tfidf-lr":
    vectorizer = joblib.load(ARTIFACTS / "vectorizer.joblib")
    vocab: dict[str, int] = vectorizer.vocabulary_

    def featurize(texts: list[str]):
        return vectorizer.transform(texts)

    # For each scam class k: weights whose dot product with the TF-IDF row is log-odds(k vs Ham).
    if len(classes) == 2:
        scam_weights = {classes[1]: head.coef_[0]}
    else:
        scam_weights = {c: head.coef_[i] - head.coef_[ham_col] for i, c in enumerate(classes) if c != 0}

else:
    raise SystemExit(f"Unknown model kind {KIND!r} in {ARTIFACTS / 'model.json'}")

app = FastAPI(title="T-Guard classifier", version=meta["model"])


class ClassifyIn(BaseModel):
    messageId: str = Field(max_length=128)
    # SMS tops out at 1,600 chars, but the dataset has emails up to ~20k. Accept them rather than
    # fail (a rejected message would trip the gateway's fail-safe); MiniLM truncates to 256 tokens.
    text: str = Field(max_length=50_000)


class Highlight(BaseModel):
    start: int
    end: int
    text: str
    weight: float


class ClassifyOut(BaseModel):
    messageId: str
    label: str  # "scam" | "legit"
    score: float  # P(scam), 0..1
    category: str | None
    model: str
    highlights: list[Highlight]


def require_token(authorization: str = Header(default="")) -> None:
    if not TOKEN:
        return
    if not secrets.compare_digest(authorization.encode(), f"Bearer {TOKEN}".encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


def class_probs(texts: list[str]) -> np.ndarray:
    """Return class probabilities for each text (columns follow head.classes_)."""
    return head.predict_proba(featurize(texts))


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def occlusion_highlights(text: str, base_scam: float) -> list[Highlight]:
    """MiniLM and stacked: drop each word, re-score, keep the words whose removal lowers P(scam) most.

    These are associations, not proof (labels were partly keyword-rule-derived).
    """
    words = [m for m in re.finditer(r"\S+", text)
             if m.group().strip(".,!?;:\"'()[]").lower() not in STOPWORDS][:MAX_HIGHLIGHT_WORDS]
    if len(words) < 2:
        return []
    variants = [text[: m.start()] + text[m.end():] for m in words]
    probs = class_probs(variants)
    # Compare log-odds, not probabilities, so drops stay visible when P(scam) is near 1.
    drops = logit(base_scam) - logit(1.0 - probs[:, ham_col])
    order = np.argsort(-drops)[:TOP_HIGHLIGHTS]
    top = drops[order[0]] if len(order) else 0.0
    out = []
    for i in order:
        if drops[i] <= 0.1:
            break
        m = words[i]
        word = m.group().strip(".,!?;:\"'()[]")
        if not word:
            continue
        start = m.start() + m.group().find(word)
        out.append(Highlight(start=start, end=start + len(word), text=word,
                             weight=round(float(drops[i] / top), 3)))
    return sorted(out, key=lambda h: h.start)


def tfidf_highlights(text: str, scam_class: int) -> list[Highlight]:
    """TF-IDF: each term's contribution is its TF-IDF value x its weight toward the predicted
    scam class (vs Ham). A word gets its own unigram's contribution plus half of each bigram
    it's part of. These are associations, not proof (labels were partly keyword-rule-derived).
    """
    row = featurize([text])
    contrib = dict(zip(row.indices, row.data * scam_weights[scam_class][row.indices]))
    words = list(TOKEN_PATTERN.finditer(text))
    lowered = [m.group().lower() for m in words]

    def term(t: str) -> float:
        i = vocab.get(t)
        return float(contrib.get(i, 0.0)) if i is not None else 0.0

    best: dict[str, float] = {}  # lowercased word -> its strongest score at any position
    for i, w in enumerate(lowered):
        if w in STOPWORDS:
            continue
        s = term(w)
        if i > 0:
            s += 0.5 * term(f"{lowered[i - 1]} {w}")
        if i + 1 < len(lowered):
            s += 0.5 * term(f"{w} {lowered[i + 1]}")
        best[w] = max(best.get(w, s), s)

    top_words = [w for w, s in sorted(best.items(), key=lambda kv: -kv[1])[:TOP_HIGHLIGHTS] if s > 0]
    if not top_words:
        return []
    top = best[top_words[0]]
    out = [Highlight(start=m.start(), end=m.end(), text=m.group(), weight=round(best[w] / top, 3))
           for m, w in zip(words, lowered) if w in top_words][:MAX_SPANS]
    return out


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model": meta["model"]}


@app.post("/classify", response_model=ClassifyOut, dependencies=[Depends(require_token)])
def classify(body: ClassifyIn) -> ClassifyOut:
    probs = class_probs([body.text])[0]
    scam = float(1.0 - probs[ham_col])
    is_scam = scam >= 0.5
    # Most likely scam class (for binary models that's just class 1).
    scam_cols = [i for i, c in enumerate(classes) if c != 0]
    scam_class = classes[max(scam_cols, key=lambda i: probs[i])]
    category = label_names[scam_class] if is_scam and meta["labels"] == "category" else None

    highlights: list[Highlight] = []
    if is_scam:
        highlights = (tfidf_highlights(body.text, scam_class) if KIND == "tfidf-lr"
                      else occlusion_highlights(body.text, scam))
    return ClassifyOut(
        messageId=body.messageId,
        label="scam" if is_scam else "legit",
        score=round(scam, 4),
        category=category,
        model=meta["model"],
        highlights=highlights,
    )
