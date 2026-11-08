#!/usr/bin/env python3
"""Build calm money-request texts, so the classifier stops reading polite asks for large sums as chat.

The training data had zero rows with "lend me", and government-threat texts were rare, so messages like
"Can you lend me $6000?" scored about 0%. This script writes:

  label 1 (Imposter & Phishing):  polite large asks, the "new number" scam, strangers asking for
                                  money, and government or legal threats demanding payment
  label 0 (Ham):                  small everyday asks, shared costs, and talk about large amounts
                                  that doesn't ask the reader for anything

Stdlib only, no network, fixed seed: two runs give byte-identical files. Template rows like these are
easy to recognize, so judge them on real or hand-written messages, not on these rows.

    python3 -I data/build_money_request_synthetic.py [out_dir]

Output: money_request_synthetic.csv (same columns as potential_threat_synthetic.csv, split=train).
classifier/build_splits.py merges it with the other template rows.
"""

from __future__ import annotations

import csv
import hashlib
import random
import sys
from pathlib import Path

SEED = 20261110
SOURCE = "synthetic_money_request"
COLUMNS = ["id", "message", "label_class", "category_name", "ftc_subcategory", "label_method",
           "label_confidence", "is_spam", "source", "style", "is_synthetic", "gen_method",
           "parent_id", "split", "scenario"]

R = random.Random(SEED)
RELATIVE = ["mom", "dad", "grandma", "grandpa", "auntie", "uncle", "sis", "bro"]
RAIL = ["zelle", "venmo", "cash app", "paypal", "wire", "western union"]
LARGE_REASON = ["my phone bill", "groceries", "a taxi", "lunch", "gas", "my textbooks", "the parking ticket", "a train ticket",
                "my rent", "the vet", "car repairs", "a hospital bill", "my tuition", "a plane ticket", "the deposit"]
SMALL_REASON = ["lunch", "coffee", "gas", "the movie", "pizza", "parking", "snacks", "the uber", "the tip", "a sandwich"]
AGENCY = ["IRS", "Social Security Administration", "county sheriff", "US Marshals", "Department of Justice", "tax office",
          "immigration office", "court clerk", "state police"]
ITEM = ["car", "roof", "new fridge", "wedding venue", "couch", "laptop", "kitchen remodel", "camper", "used truck"]


def large() -> str:
    n = R.choice([800, 950, 1200, 1500, 1800, 2000, 2500, 3000, 3500, 4000, 4800, 5000, 5500, 7000, 7500, 8000, 9000, 12000])
    return R.choice([f"${n}", f"${n:,}", f"{n} dollars", f"{n}$", f"${n / 1000:g}k"])


def small() -> str:
    n = R.choice([3, 5, 8, 10, 12, 15, 20, 25, 30, 40])
    return R.choice([f"${n}", f"{n} bucks", f"{n} dollars", f"{n}$"])


def polite_large_ask() -> str:
    a, why = large(), R.choice(LARGE_REASON)
    return R.choice([f"Can you lend me {a} for {why}?", f"could you lend me {a}", f"can u spot me {a} for {why}", f"Would you be able to loan me {a} for {why}?",
                     f"Hey can I borrow {a} for {why}? will pay you back", f"hi, can you send me {a} for {why}", f"Any chance you could lend me {a} this week?",
                     f"I hate to ask but could you loan me {a}", f"can you {R.choice(RAIL)} me {a} for {why}", f"need to borrow {a} for {why}, can you help"])


def new_number() -> str:
    a, who, why = large(), R.choice(RELATIVE), R.choice(LARGE_REASON)
    return R.choice([f"Hi {who} this is my new number, can you send {a} for {why}", f"{who} I broke my phone, using a friends, can you {R.choice(RAIL)} me {a}",
                     f"hey {who} its me, new phone, I need {a} for {why} today", f"Hi {who}, I dropped my phone in water, this is my new number. Can you transfer {a}?",
                     f"{who} please save this number, lost my old phone. could you help me with {a} for {why}"])


def stranger_request() -> str:
    a, why = large(), R.choice(LARGE_REASON)
    return R.choice([f"Hello dear, I am stranded and need {a} for {why}, please help me", f"Hi, we met last year. Could you loan me {a} for {why}?",
                     f"Hello friend, please can you send {a}, I will return it next week", f"good day, kindly lend me {a} for {why}, god bless you",
                     f"This is your neighbor, I forgot my wallet. Can you {R.choice(RAIL)} me {a}?"])


def gov_threat() -> str:
    ag, a = R.choice(AGENCY), large()
    return R.choice([f"{ag} final notice: pay now or a warrant will be issued for your arrest", f"This is the {ag}. You owe {a}. Pay today to avoid arrest",
                     f"{ag} notice: your case goes to court unless {a} is paid by today", f"FINAL WARNING from the {ag}: unpaid balance of {a}, legal action begins tomorrow",
                     f"{ag}: a lawsuit has been filed in your name. Call back now to settle", f"Your social security number is suspended by the {ag}. Pay {a} to restore it",
                     f"The {ag} has issued a warrant in your name. Avoid jail by paying {a} in gift cards"])


def small_ask() -> str:
    a, why, who = small(), R.choice(SMALL_REASON), R.choice(RELATIVE)
    return R.choice([f"can you lend me {a} for {why}", f"lend me {a} till friday?", f"hey can I borrow {a} for {why}", f"can u spot me {a}, forgot my wallet", f"{who} can you {R.choice(RAIL[:3])} me {a} for {why}",
                     f"can you send me {a} for {why}, ill get you back tmrw", f"Could you lend me {a} for {why}? thanks!", f"you owe me {a} from {why} lol", f"can you pay me back the {a} for {why}"])


def shared_cost() -> str:
    a = R.choice(["$450", "$600", "$900", "$1200", "$1,400", "$1800"])
    return R.choice([f"rent is {a} this month, venmo me your half when you can", f"the landlord raised rent to {a}, can you believe it", f"the plumber quote was {a}, split it with me?",
                     f"our share of the cabin is {a}, I already paid it", f"tuition is due friday, it's {a} this semester", f"insurance went up to {a} a year, ugh"])


def money_talk() -> str:
    a, it = large(), R.choice(ITEM)
    return R.choice([f"the {it} ended up costing {a}", f"they want {a} for the {it}, way too much", f"we saved {a} for the {it}!", f"I got a {a} bonus at work!!", f"sold my {it} for {a} today",
                     f"paying off the {it} next month, only {a} left", f"mechanic said {a} to fix it, might just sell the {it}"])


SPEC = [(1, "polite_large_ask", polite_large_ask, 340), (1, "new_number", new_number, 170), (1, "stranger_request", stranger_request, 130), (1, "gov_threat", gov_threat, 260),
        (0, "small_ask", small_ask, 360), (0, "shared_cost", shared_cost, 140), (0, "money_talk", money_talk, 200)]


def noise(t: str) -> str:
    x = R.random()
    return t.upper() if x < 0.08 else t.lower() if x < 0.33 else t.rstrip("?.") if x < 0.45 else t


def build() -> list[dict]:
    rows, seen = [], set()
    for label, scenario, fn, want in SPEC:
        made = tries = 0
        while made < want and tries < want * 200:
            tries += 1
            text = noise(fn())
            if text.lower() in seen:
                continue
            seen.add(text.lower())
            made += 1
            rows.append({"id": "s" + hashlib.sha1(f"{SOURCE}|{text}".encode()).hexdigest()[:12], "message": text, "label_class": label,
                         "category_name": "Imposter & Phishing" if label else "Ham", "ftc_subcategory": -1 if label else 0, "label_method": "template" if label else "ham",
                         "label_confidence": 1.0, "is_spam": int(label != 0), "source": SOURCE, "style": "sms", "is_synthetic": True, "gen_method": "template",
                         "parent_id": "", "split": "train", "scenario": scenario})
    return rows


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    rows = build()
    with open(out / "money_request_synthetic.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(len(rows), "rows")


if __name__ == "__main__":
    main()
