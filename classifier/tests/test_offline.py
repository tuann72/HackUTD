"""Tests that need no trained artifacts, GPU, PyTorch or model download.

    cd classifier && pytest tests          # these run; test_service.py skips without real artifacts

A tiny TF-IDF model is trained on synthetic rows (conftest.py). MiniLM is covered with a fake
`sentence_transformers` module, so the occlusion code runs without the real encoder.
"""
from __future__ import annotations

import json
import sys
import types

import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LogisticRegression

from conftest import AUTH

SCAM = "Congratulations you won a free gift card claim your prize now"
LEGIT = "Are we still on for dinner tonight at seven"
# The exact keys the gateway's parseVerdict reads (services/gateway/src/classifier.ts).
GATEWAY_KEYS = {"messageId", "label", "score", "category", "model", "highlights"}
CATEGORIES = {
    "Imposter & Phishing", "Prizes, Lotteries & Advance-Fee", "Jobs, Business & Investment",
    "Loans, Credit & Debt", "Health & Pharmacy", "Shopping & Product Offers", "Internet, Telecom & Media",
    "Threats & Extortion",
}


def assert_gateway_shape(out: dict, message_id: str, text: str) -> None:
    """Mirror of the gateway's parseVerdict, so a service change that the gateway would
    reject (and fail open on) fails here first."""
    assert set(out) == GATEWAY_KEYS
    assert out["messageId"] == message_id
    assert out["label"] in ("scam", "legit")
    assert isinstance(out["score"], (int, float)) and 0 <= out["score"] <= 1
    assert out["category"] is None or out["category"] in CATEGORIES
    assert isinstance(out["model"], str) and out["model"]
    for h in out["highlights"]:
        assert set(h) == {"start", "end", "text", "weight"}
        assert isinstance(h["start"], int) and isinstance(h["end"], int)
        assert 0 <= h["start"] < h["end"] <= len(text)
        assert text[h["start"]:h["end"]] == h["text"]
        assert np.isfinite(h["weight"])


def post(client, text, message_id="m1", headers=AUTH):
    return client.post("/classify", json={"messageId": message_id, "text": text}, headers=headers)


# --- train.py ---------------------------------------------------------------------------


def test_train_tfidf_writes_loadable_artifacts(tfidf_category_artifacts):
    d = tfidf_category_artifacts
    for f in ("model.json", "head.joblib", "vectorizer.joblib", "keywords.json", "metrics.json"):
        assert (d / f).exists(), f
    meta = json.loads((d / "model.json").read_text())
    assert meta["kind"] == "tfidf-lr"
    assert meta["labels"] == "category"
    assert meta["model"] == "tfidf-lr-category@0.1"
    assert meta["label_names"][0] == "Ham" and len(meta["label_names"]) == 9
    metrics = json.loads((d / "metrics.json").read_text())
    assert "test" not in metrics  # train.py must not score the test split
    assert set(metrics["val"]["scam_vs_ham"]) == {"precision", "recall", "f1"}
    assert "sms_scam_vs_ham_f1" in metrics["val"]
    # The tiny data is separable; a broken pipeline would land near chance.
    assert metrics["val"]["scam_vs_ham"]["f1"] >= 0.9
    head = joblib.load(d / "head.joblib")
    assert 0 in head.classes_
    keywords = json.loads((d / "keywords.json").read_text())
    assert set(keywords) <= CATEGORIES


def test_binary_training_writes_binary_metadata(tfidf_binary_artifacts):
    meta = json.loads((tfidf_binary_artifacts / "model.json").read_text())
    assert meta["labels"] == "binary" and meta["label_names"] == ["Ham", "Scam"]


# --- service: TF-IDF ----------------------------------------------------------------------


@pytest.fixture
def tfidf_client(load_service, tfidf_category_artifacts):
    return TestClient(load_service(tfidf_category_artifacts).app)


def test_healthz_reports_model(tfidf_client):
    r = tfidf_client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "model": "tfidf-lr-category@0.1"}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "test-token"}])
def test_classify_requires_the_bearer_token(tfidf_client, headers):
    assert post(tfidf_client, SCAM, headers=headers).status_code == 401


def test_scam_matches_gateway_contract_with_exact_tfidf_spans(tfidf_client):
    out = post(tfidf_client, SCAM, message_id="msg_abc").json()
    assert_gateway_shape(out, "msg_abc", SCAM)
    assert out["label"] == "scam" and out["score"] >= 0.5
    assert out["category"] == "Prizes, Lotteries & Advance-Fee"
    assert out["highlights"], "a scam should come with highlights"
    words = {h["text"].lower() for h in out["highlights"]}
    assert words & {"won", "gift", "prize", "claim", "free", "card"}
    assert max(h["weight"] for h in out["highlights"]) == 1.0


def test_legit_has_no_category_or_highlights(tfidf_client):
    out = post(tfidf_client, LEGIT).json()
    assert_gateway_shape(out, "m1", LEGIT)
    assert out == {**out, "label": "legit", "category": None, "highlights": []}


def test_spans_survive_punctuation_case_and_repeats(tfidf_client):
    text = "WINNER!! You WON a gift-card... claim it: claim your PRIZE, prize, prize now"
    out = post(tfidf_client, text).json()
    assert_gateway_shape(out, "m1", text)


def test_edge_inputs(tfidf_client):
    for text in ["", "a", "🎁🎁🎁", "won " * 5000]:
        r = post(tfidf_client, text)
        assert r.status_code == 200, (text[:20], r.text)
        assert_gateway_shape(r.json(), "m1", text)
    assert tfidf_client.post("/classify", json={"text": "hi"}, headers=AUTH).status_code == 422
    assert post(tfidf_client, "x" * 50_001).status_code == 422


def test_binary_model_never_returns_a_category(load_service, tfidf_binary_artifacts):
    client = TestClient(load_service(tfidf_binary_artifacts).app)
    out = post(client, SCAM).json()
    assert_gateway_shape(out, "m1", SCAM)
    assert out["label"] == "scam" and out["category"] is None
    assert out["model"] == "tfidf-lr-binary@0.1"


def test_refuses_to_start_without_a_token(load_service, tfidf_category_artifacts):
    with pytest.raises(SystemExit, match="CLASSIFIER_TOKEN"):
        load_service(tfidf_category_artifacts, token=None)


# --- service: MiniLM occlusion, with a fake encoder ---------------------------------------

SCAM_WORDS = ("won", "gift", "prize", "claim")


class FakeSentenceTransformer:
    """Stands in for MiniLM: one feature per scam word, plus a bias-ish constant."""

    def __init__(self, name, device="cpu"):
        self.name = name

    def encode(self, texts, **_):
        rows = []
        for t in texts:
            low = t.lower()
            rows.append([float(low.count(w)) for w in SCAM_WORDS] + [1.0])
        return np.array(rows)


@pytest.fixture
def minilm_client(load_service, tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "sentence_transformers",
                        types.SimpleNamespace(SentenceTransformer=FakeSentenceTransformer))
    enc = FakeSentenceTransformer("fake")
    texts = [SCAM, "claim your prize", "you won a gift", LEGIT, "see you at practice", "pick up milk"]
    y = [2, 2, 2, 0, 0, 0]
    head = LogisticRegression(C=10.0, max_iter=1000).fit(enc.encode(texts), y)
    joblib.dump(head, tmp_path / "head.joblib")
    names = ["Ham", "Imposter & Phishing", "Prizes, Lotteries & Advance-Fee", "Jobs, Business & Investment",
             "Loans, Credit & Debt", "Health & Pharmacy", "Shopping & Product Offers", "Internet, Telecom & Media"]
    (tmp_path / "model.json").write_text(json.dumps({
        "kind": "minilm-lr", "model": "minilm-lr-category@test", "labels": "category",
        "label_names": names, "encoder": "sentence-transformers/all-MiniLM-L6-v2",
    }))
    return TestClient(load_service(tmp_path).app)


def test_minilm_occlusion_highlights_the_words_that_matter(minilm_client):
    text = "Hey! You WON a gift, claim your prize."
    out = post(minilm_client, text).json()
    assert_gateway_shape(out, "m1", text)
    assert out["label"] == "scam" and out["category"] == "Prizes, Lotteries & Advance-Fee"
    found = {h["text"].lower() for h in out["highlights"]}
    assert found and found <= set(SCAM_WORDS)
    assert [h["start"] for h in out["highlights"]] == sorted(h["start"] for h in out["highlights"])


def test_minilm_legit_and_one_word_inputs(minilm_client):
    assert post(minilm_client, LEGIT).json()["highlights"] == []
    out = post(minilm_client, "prize").json()  # one word: occlusion has nothing to compare
    assert_gateway_shape(out, "m1", "prize")
