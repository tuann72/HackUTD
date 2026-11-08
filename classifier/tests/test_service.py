"""Service tests. Need trained artifacts in classifier/artifacts/ or $CLASSIFIER_ARTIFACTS (skipped otherwise).

    cd classifier && pytest tests
"""
import os
from pathlib import Path

import pytest

ARTIFACTS = Path(os.environ.get("CLASSIFIER_ARTIFACTS", Path(__file__).resolve().parent.parent / "artifacts"))
pytestmark = pytest.mark.skipif(not (ARTIFACTS / "head.joblib").exists(), reason="no trained artifacts")

os.environ.setdefault("CLASSIFIER_TOKEN", "test-token")
AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from service.app import app
    return TestClient(app)


def classify(client, text):
    r = client.post("/classify", json={"messageId": "t1", "text": text}, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def test_rejects_missing_token(client):
    assert client.post("/classify", json={"messageId": "t1", "text": "hi"}).status_code == 401


def test_obvious_scam(client):
    text = "Congratulations! You won a $1000 gift card. Claim now at bit.ly/xx before midnight"
    out = classify(client, text)
    assert out["label"] == "scam" and out["score"] > 0.5
    for h in out["highlights"]:  # spans must point at the returned words
        assert text[h["start"]:h["end"]] == h["text"]


def test_obvious_legit(client):
    out = classify(client, "hey are we still on for dinner at 7? I'll grab the table")
    assert out["label"] == "legit" and out["highlights"] == []


def test_accepts_long_email(client):
    classify(client, "meeting notes " * 2000)  # ~28k chars: must not 422
