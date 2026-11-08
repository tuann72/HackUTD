"""build_splits.py keeps held-out text out of training. No model or GPU needed."""
import pandas as pd

from build_splits import clean_splits


def row(id, text, split, label=1, synthetic=False, parent=None, scenario=None):
    return {"id": id, "message": text, "label_class": label, "is_spam": int(label != 0), "split": split, "style": "sms",
            "is_synthetic": synthetic, "parent_id": parent, "source": "x", "scenario": scenario}


def build(base_rows, threat_rows=()):
    threats = list(threat_rows) or [row("th", "pay or else friend", "train", 8, True, scenario="a")]
    return clean_splits(pd.DataFrame(base_rows), pd.DataFrame(threats), pd.DataFrame([row("ev", "they have your son", "threat_eval", 8, True, scenario="b")]))


def test_case_punctuation_and_digit_variants_of_test_leave_train():
    tv, test, _, _ = build([row("t", "Win $500 NOW!", "test"), row("a", "win 900 now", "train"), row("b", "other words here", "train"), row("v", "val text", "val")])
    assert set(tv.id) >= {"b", "v"} and "a" not in set(tv.id) and list(test.id) == ["t"]


def test_reordered_long_text_leaves_train():
    words = "one two three four five six seven eight nine"
    tv, _, _, _ = build([row("t", words, "test"), row("a", " ".join(reversed(words.split())), "train"), row("v", "val text", "val")])
    assert "a" not in set(tv.id)


def test_val_text_leaves_train_and_test_text_leaves_val():
    tv, _, _, _ = build([row("t", "held test", "test"), row("v1", "held test", "val"), row("v2", "held val", "val"), row("a", "held val", "train")])
    assert "v1" not in set(tv.id) and "a" not in set(tv.id) and "v2" in set(tv.id)


def test_synthetic_child_of_a_held_out_message_is_dropped():
    tv, _, _, _ = build([row("t", "held test", "test"), row("c", "a rewritten version", "train", 1, True, parent="t"), row("v", "val text", "val")])
    assert "c" not in set(tv.id)


def test_threat_eval_text_never_trains():
    rows = [row("t", "held test", "test"), row("v", "val text", "val"), row("a", "they have your son", "train", 8)]
    tv, _, ev, _ = build(rows)
    assert "a" not in set(tv.id) and list(ev.id) == ["ev"]


def test_some_of_each_threat_scenario_reaches_val_and_test_stays_real():
    threats = [row(f"th{i}", f"unique threat number {chr(97 + i % 26)}{chr(97 + i // 26)}", "train", 8, True, scenario="a") for i in range(40)]
    tv, test, _, stats = build([row("t", "held test", "test"), row("v", "val text", "val")], threats)
    assert stats["output"]["val_templates"] == 6
    assert not test.is_synthetic.any()
