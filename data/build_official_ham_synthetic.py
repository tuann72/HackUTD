#!/usr/bin/env python3
"""Build harmless texts about taxes, IDs, government offices, health and pharmacies (label 0, Ham).

gov_health_id_scam_synthetic.csv has 600 scam rows and no harmless counterparts, so words like "IRS",
"Medicare", "license" or "prescription" could become scam cues by themselves, the way "free" did.
These rows use the same topics without a threat, a payment demand, a link or a request for ID numbers.

Stdlib only, no network, fixed seed: two runs give byte-identical files. Template rows like these are
easy to recognize, so judge them on real or hand-written messages, not on these rows.

    python3 -I data/build_official_ham_synthetic.py [out_dir]

Output: official_ham_synthetic.csv (same columns as potential_threat_synthetic.csv, all label 0,
split=train). classifier/build_splits.py merges it with the other template rows.
"""

from __future__ import annotations

import csv
import hashlib
import random
import sys
from pathlib import Path

SEED = 20261111
SOURCE = "synthetic_official_ham"
COLUMNS = ["id", "message", "label_class", "category_name", "ftc_subcategory", "label_method",
           "label_confidence", "is_spam", "source", "style", "is_synthetic", "gen_method",
           "parent_id", "split", "scenario"]

R = random.Random(SEED)
PERSON = ["mom", "dad", "grandma", "grandpa", "auntie", "my sister", "my brother", "my neighbor", "my boss", "the accountant"]
DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "tomorrow", "next week", "this afternoon"]
TIME = ["9am", "10:30", "noon", "2pm", "3:15", "4pm"]
PHARMACY = ["CVS", "Walgreens", "the pharmacy", "Rite Aid", "the Walmart pharmacy", "Kroger pharmacy"]
MED = ["prescription", "refill", "blood pressure meds", "inhaler", "allergy medicine", "insulin", "antibiotics", "eye drops"]
DOCTOR = ["the doctor", "the dentist", "the eye doctor", "Dr. Patel", "Dr. Nguyen", "the cardiologist", "physical therapy", "the clinic"]
OFFICE = ["the DMV", "the post office", "the social security office", "city hall", "the courthouse", "the passport office", "the county clerk"]
IDDOC = ["license", "passport", "ID", "birth certificate", "social security card", "insurance card", "medicare card"]


def tax_talk() -> str:
    p = R.choice(PERSON)
    return R.choice([
        "did you file your taxes yet", f"{p} is helping me with my taxes {R.choice(DAY)}", "finally got my IRS refund!!", "the IRS website is so confusing lol",
        f"I mailed the tax forms {R.choice(DAY)}", "my W2 came in the mail", "ugh tax season again", f"can {p} look over my 1040?", "we owe a little this year but it's fine, already paid it",
        "tax appointment got moved", f"I have the tax guy at {R.choice(TIME)}", "got a letter from the IRS, turns out it was just my refund amount", "do you still have last year's tax return?",
        "the refund hit my account today", "H&R Block is open late this week", f"filing the taxes {R.choice(DAY)}, need your W2",
    ])


def government_chat() -> str:
    o = R.choice(OFFICE)
    return R.choice([
        f"the line at {o} was insane", f"going to {o} {R.choice(DAY)}", f"{o} closes at {R.choice(['4', '4:30', '5'])}", f"had jury duty at {o} all day", f"{R.choice(PERSON)} works at {o} now",
        f"I have an appointment at {o} at {R.choice(TIME)}", f"just got back from {o}, took forever", "my jury summons came, ugh", "social security check came on time this month",
        "the sheriff's office is doing a food drive", "the police were directing traffic on main st", "got a parking ticket downtown, paid it online already", "US Marshals show was good last night lol",
        f"can you drive me to {o} {R.choice(DAY)}?", "the court date got moved to next month, the lawyer told us",
    ])


def id_logistics() -> str:
    d = R.choice(IDDOC)
    return R.choice([
        f"don't forget your {d}", f"bring your {d} to the appointment", f"I left my {d} on the counter", f"did you renew your {d}?", f"my {d} expires {R.choice(DAY)}", f"found your {d} in the car",
        f"they asked for my {d} at the airport", f"need to get a new {d} photo lol", f"have you seen my {d}?", f"I got my new {d} in the mail", f"grab my {d} from the drawer please",
        f"can you check if {R.choice(PERSON)} has the {d}?",
    ])


def health_chat() -> str:
    d = R.choice(DOCTOR)
    return R.choice([
        f"appointment with {d} at {R.choice(TIME)}", f"{R.choice(PERSON)} sees {d} {R.choice(DAY)}", f"{d} said everything looks good", f"got my lab results back, all normal", f"running late for {d}",
        "medicare open enrollment starts soon, want to go over it together?", f"{R.choice(PERSON)}'s medicare covers the visit", "my insurance covered most of it", "flu shots at the clinic this week",
        f"can you take me to {d} {R.choice(DAY)}?", "the nurse called, results are fine", "feeling better after the checkup", f"reminder: {d} {R.choice(DAY)} at {R.choice(TIME)}",
    ])


def pharmacy_notice() -> str:
    ph, med = R.choice(PHARMACY), R.choice(MED)
    return R.choice([
        f"picked up your {med} from {ph}", f"can you grab my {med} at {ph}?", f"{ph} says the {med} will be ready {R.choice(DAY)}", f"{ph}: your {med} is ready", f"Your {med} is ready at {ph}. Thank you.",
        f"Reminder from {ph}: your {med} is due for a refill", f"{ph} closes early {R.choice(DAY)}, need your {med}?", f"{ph} is out of my {med}, trying another one", f"stopping at {ph} on the way home, need anything",
        f"my {med} ran out, calling {ph}", f"Your package from {ph} has shipped and arrives {R.choice(DAY)}",
    ])


def appointment_notice() -> str:
    d = R.choice(DOCTOR)
    return R.choice([
        f"Reminder: you have an appointment with {d} {R.choice(DAY)} at {R.choice(TIME)}", f"Your appointment with {d} is confirmed for {R.choice(DAY)}", f"{d}: please arrive 15 minutes early {R.choice(DAY)}",
        f"Your order is out for delivery and arrives {R.choice(DAY)}", f"Your library books are due {R.choice(DAY)}", f"Your car is ready, the shop closes at {R.choice(['5', '6'])}", "Your table is ready, please come to the host stand",
        f"School closes early {R.choice(DAY)} because of the weather", f"Trash pickup moves to {R.choice(DAY)} this week because of the holiday",
    ])


SPEC = [("tax_talk", tax_talk, 110), ("government_chat", government_chat, 130), ("id_logistics", id_logistics, 110),
        ("health_chat", health_chat, 130), ("pharmacy_notice", pharmacy_notice, 130), ("appointment_notice", appointment_notice, 90)]


def noise(t: str) -> str:
    x = R.random()
    return t.upper() if x < 0.05 else t.lower() if x < 0.25 else t


def build() -> list[dict]:
    rows, seen = [], set()
    for scenario, fn, want in SPEC:
        made = tries = 0
        while made < want and tries < want * 300:
            tries += 1
            text = noise(fn())
            if text.lower() in seen:
                continue
            seen.add(text.lower())
            made += 1
            rows.append({"id": "s" + hashlib.sha1(f"{SOURCE}|{text}".encode()).hexdigest()[:12], "message": text, "label_class": 0, "category_name": "Ham", "ftc_subcategory": 0,
                         "label_method": "ham", "label_confidence": 1.0, "is_spam": 0, "source": SOURCE, "style": "sms", "is_synthetic": True, "gen_method": "template", "parent_id": "",
                         "split": "train", "scenario": scenario})
    return rows


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    rows = build()
    with open(out / "official_ham_synthetic.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(len(rows), "rows")


if __name__ == "__main__":
    main()
