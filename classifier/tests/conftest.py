"""Shared fixtures. Nothing here downloads a model or needs a GPU, PyTorch or the real dataset.

- `tiny_csv`: ~60 synthetic rows in the same columns as data/scam_categories_100k_full.csv.
- `load_service(artifacts_dir, token)`: imports service/app.py fresh against those artifacts
  (the module loads its model at import time, so each test model needs a fresh import).
"""
from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

CLASSIFIER_DIR = Path(__file__).resolve().parent.parent
if str(CLASSIFIER_DIR) not in sys.path:
    sys.path.insert(0, str(CLASSIFIER_DIR))

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

# label_class follows data/scam_categories.csv: 0 Ham, 1 Imposter & Phishing, 2 Prizes, Lotteries & Advance-Fee.
_PRIZE = [
    "Congratulations you won a free gift card claim your prize now",
    "You won the lottery claim your cash prize today",
    "Winner! Claim your free gift card prize at the link now",
    "You have won a prize claim the gift card before midnight",
    "Claim your free prize now you won a gift card",
]
_PHISH = [
    "Your bank account is locked verify your login now",
    "Urgent your account is suspended verify your password",
    "Security alert verify your bank login to unlock your account",
    "Your account is locked please verify your password urgently",
    "Bank alert account suspended verify login immediately",
]
_HAM = [
    "Are we still on for dinner tonight at seven",
    "See you at soccer practice after school tomorrow",
    "Can you pick up milk and bread on the way home",
    "Happy birthday grandma we love you see you sunday",
    "Dinner was great thanks for having us tonight",
    "Running late to practice, see you in ten minutes",
]


@pytest.fixture(scope="session")
def tiny_csv(tmp_path_factory) -> Path:
    rows = []
    for split, reps in (("train", 3), ("val", 1), ("test", 1)):
        for r in range(reps):
            for label, texts in ((2, _PRIZE), (1, _PHISH), (0, _HAM)):
                for t in texts:
                    rows.append({"message": f"{t} {r}" if split == "train" else t, "label_class": label,
                                 "is_spam": int(label != 0), "split": split, "style": "sms"})
    df = pd.DataFrame(rows)
    df.insert(0, "id", range(len(df)))
    path = tmp_path_factory.mktemp("data") / "tiny.csv"
    df.to_csv(path, index=False)
    return path


def run_train(data: Path, out: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CLASSIFIER_DIR / "train.py"), "--model", "tfidf", "--data", str(data), "--out", str(out), *extra],
        capture_output=True, text=True, check=True,
    )


@pytest.fixture(scope="session")
def tfidf_category_artifacts(tiny_csv, tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("tfidf_category")
    run_train(tiny_csv, out)
    return out


@pytest.fixture(scope="session")
def tfidf_binary_artifacts(tiny_csv, tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("tfidf_binary")
    run_train(tiny_csv, out, "--labels", "binary")
    return out


@pytest.fixture
def load_service(monkeypatch):
    def _load(artifacts: Path, token: str | None = TOKEN):
        monkeypatch.setenv("CLASSIFIER_ARTIFACTS", str(artifacts))
        if token is None:
            monkeypatch.delenv("CLASSIFIER_TOKEN", raising=False)
            monkeypatch.delenv("CLASSIFIER_ALLOW_NO_AUTH", raising=False)
        else:
            monkeypatch.setenv("CLASSIFIER_TOKEN", token)
        sys.modules.pop("service.app", None)
        return importlib.import_module("service.app")

    yield _load
    sys.modules.pop("service.app", None)
