"""T-Gate classifier inference service.

POST /classify  {"messageId": "...", "text": "..."}
             -> {"label", "score", "category", "model", "highlights"}
GET  /healthz

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
from sentence_transformers import SentenceTransformer

ARTIFACTS = Path(os.environ.get("CLASSIFIER_ARTIFACTS", Path(__file__).resolve().parent.parent / "artifacts"))
TOKEN = os.environ.get("CLASSIFIER_TOKEN", "")
if not TOKEN and os.environ.get("CLASSIFIER_ALLOW_NO_AUTH") != "1":
    raise SystemExit("Set CLASSIFIER_TOKEN (or CLASSIFIER_ALLOW_NO_AUTH=1 for local development).")
MAX_HIGHLIGHT_WORDS = 60  # occlusion cost grows with word count; long texts only score the first N words
TOP_HIGHLIGHTS = 5
STOPWORDS = set("a an the is are was were be to of in on at for and or but your you my me i we it this that with from by as our us".split())

meta = json.loads((ARTIFACTS / "model.json").read_text())
head = joblib.load(ARTIFACTS / "head.joblib")
encoder = SentenceTransformer(meta["encoder"], device=os.environ.get("CLASSIFIER_DEVICE", "cpu"))
label_names: list[str] = meta["label_names"]
ham_col = list(head.classes_).index(0)

app = FastAPI(title="T-Gate classifier", version=meta["model"])


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


def scam_scores(texts: list[str]) -> np.ndarray:
    """Return class probabilities for each text."""
    emb = encoder.encode(texts, batch_size=64, normalize_embeddings=True, convert_to_numpy=True)
    return head.predict_proba(emb)


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def occlusion_highlights(text: str, base_scam: float) -> list[Highlight]:
    """Drop each word, re-score, and keep the words whose removal lowers P(scam) most.

    These are associations, not proof (labels were partly keyword-rule-derived).
    """
    words = [m for m in re.finditer(r"\S+", text)
             if m.group().strip(".,!?;:\"'()[]").lower() not in STOPWORDS][:MAX_HIGHLIGHT_WORDS]
    if len(words) < 2:
        return []
    variants = [text[: m.start()] + text[m.end():] for m in words]
    probs = scam_scores(variants)
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


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model": meta["model"]}


@app.post("/classify", response_model=ClassifyOut, dependencies=[Depends(require_token)])
def classify(body: ClassifyIn) -> ClassifyOut:
    probs = scam_scores([body.text])[0]
    scam = float(1.0 - probs[ham_col])
    is_scam = scam >= 0.5
    category = None
    if is_scam and meta["labels"] == "category":
        scam_cols = [i for i, c in enumerate(head.classes_) if c != 0]
        best = max(scam_cols, key=lambda i: probs[i])
        category = label_names[int(head.classes_[best])]
    return ClassifyOut(
        messageId=body.messageId,
        label="scam" if is_scam else "legit",
        score=round(scam, 4),
        category=category,
        model=meta["model"],
        highlights=occlusion_highlights(body.text, scam) if is_scam else [],
    )
