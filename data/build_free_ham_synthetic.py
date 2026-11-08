#!/usr/bin/env python3
"""Build harmless "free" texts (label 0, Ham) so the classifier stops reading "free" as scam.

In scam_categories_100k_full.csv the word "free" appears in about 5,800 scam rows and only about
2,100 ham rows, so the model treats it as a strong scam cue and flags everyday texts such as
"Feel free to call me" or "free pizza in the break room". This script writes 300 everyday ham
texts that use "free" harmlessly: "feel free", "are you free tonight", free food at work or
school, "parking is free after 6", and idioms like "gluten free" or "hands free".

None of them has a link, a phone number, a prize, a "claim"/"reply" call to action or a money
request, so the label stays clearly ham.

Stdlib only, no network, fixed seed: two runs give byte-identical files.

    python3 -I data/build_free_ham_synthetic.py            # writes next to this script
    python3 -I data/build_free_ham_synthetic.py <out_dir>

Output (same columns as potential_threat_synthetic.csv, so build_splits.py merges it the same way):
  free_ham_synthetic.csv  300 rows, all label 0, split=train, is_synthetic=True
"""

from __future__ import annotations

import csv
import hashlib
import random
import re
import sys
from pathlib import Path

SEED = 20261109
SOURCE = "synthetic_free_ham"

COLUMNS = ["id", "message", "label_class", "category_name", "ftc_subcategory", "label_method",
           "label_confidence", "is_spam", "source", "style", "is_synthetic", "gen_method",
           "parent_id", "split", "scenario"]

COUNTS = {
    "feel_free": 80,         # "feel free to call me anytime"
    "free_time": 70,         # "are you free tonight?"
    "free_food_event": 60,   # "free pizza in the break room"
    "free_everyday": 50,     # "parking is free after 6", "free refills"
    "free_idiom": 40,        # "gluten free", "hands free", "free throw"
}

# ---------------------------------------------------------------- slot values

NAMES = ["jake", "emily", "carlos", "maria", "tyler", "ashley", "kevin", "jess", "danny", "sofia",
         "mike", "nina", "jordan", "lucy", "omar", "priya", "ben", "chloe", "luis", "hannah"]
FAMILY = ["mom", "dad", "grandma", "grandpa", "auntie", "uncle", "babe", "bro", "sis"]
TIMES = ["tonight", "tomorrow", "this weekend", "saturday", "sunday", "friday night", "after work",
         "after class", "later today", "monday morning", "around 7", "after 5", "this afternoon",
         "next week", "at lunch"]
FOODS = ["pizza", "donuts", "bagels", "tacos", "coffee", "cookies", "ice cream", "cupcakes",
         "sandwiches", "breakfast burritos", "popcorn", "snacks", "cake", "hot dogs", "lemonade"]
PLACES_FOOD = ["in the break room", "in the lobby", "at the student union", "on the 3rd floor",
               "in the kitchen", "at the library", "after the meeting", "at the front desk",
               "at the club fair", "outside the gym", "in the conference room", "at church"]
EVENTS = ["the career fair", "orientation", "the town hall", "the open house", "the farmers market",
          "the block party", "the hackathon", "the team meeting", "the info session", "the game"]
FRIDGE = ["leftovers in the fridge", "the snacks in the pantry", "whatever is in the fridge",
          "the extra blankets in the closet", "the guest room", "my charger", "the spare umbrella",
          "the wifi, password is on the router", "the coffee maker", "anything in the kitchen"]

# Every template uses "free" in an everyday, harmless sense.
FEEL_FREE = [
    "feel free to call me anytime",
    "feel free to text me if you need anything",
    "feel free to bring {name} along",
    "feel free to grab {fridge}",
    "feel free to come over {time}",
    "feel free to stop by {time}, ill be home",
    "feel free to use {fridge} while we're away",
    "feel free to bring a friend {time}",
    "feel free to swing by the office {time}",
    "feel free to borrow my car {time}, keys are on the hook",
    "feel free to send me the notes when you get a chance",
    "feel free to reschedule if {time} doesn't work",
    "feel free to ignore my last text lol",
    "feel free to ask {name}, she knows the way",
    "feel free to crash on the couch {time}",
    "{family} feel free to call when you land",
    "hey {name}, feel free to add anything to the shopping list",
    "feel free to make yourself at home",
    "feel free to bring dessert {time} if you want",
    "feel free to let the dog out back, he loves the yard",
    "feel free to edit the doc, i shared it with you",
    "feel free to take the leftover {food} home",
    "feel free to jump in on the group chat",
    "feel free to come early and help set up",
    "if you have questions feel free to reach out {time}",
    "feel free to pick whatever movie you want {time}",
    "feel free to park in our driveway {time}",
    "feel free to drop the kids off {time}, no rush",
    "thanks {name}! feel free to keep the book as long as you want",
    "feel free to wear jeans, its casual",
]
FREE_TIME = [
    "are you free {time}?",
    "you free {time}",
    "im free {time} if you want to grab {food}",
    "{family} are you free {time}? want to get lunch",
    "let me know when you're free",
    "text me when you're free to talk",
    "hey {name} are you free for a quick call {time}",
    "im not free {time} but {time2} works",
    "free {time}? movie night at my place",
    "are you free to help me move {time}",
    "my schedule is free {time}, pick a time",
    "i finally have a free afternoon {time}",
    "is {name} free {time}? we need a 4th for doubles",
    "free for coffee {time}?",
    "when are you free this week? i miss you",
    "{family} im free {time}, want me to come by",
    "are you guys free {time} for dinner",
    "my calendar is free {time}, lets do it",
    "im free all day {time} lol so bored",
    "got a free hour {time}, want to call?",
    "free to watch the game {time}?",
    "are you free to pick up {name} from practice {time}",
    "i have a free period {time} if you want to study",
    "is anyone free {time} to walk the dog",
]
FREE_FOOD_EVENT = [
    "free {food} {place_food}",
    "theres free {food} {place_food} if you want some",
    "they have free {food} at {event}",
    "free {food} {place_food}, come quick before its gone lol",
    "{name} brought free {food} for everyone {place_food}",
    "heads up, free {food} {place_food}",
    "they're giving out free {food} at {event}",
    "free {food} at {event} {time}, wanna go?",
    "there was free {food} at {event}, i grabbed you some",
    "lol i only went to {event} for the free {food}",
    "free {food} and free coffee {place_food}",
    "the dentist gave the kids free toothbrushes lol",
    "{event} has free parking and free {food}",
    "boss got free {food} for the team {place_food}",
    "free {food} for volunteers at {event}",
    "free entry to {event} {time}, wanna come?",
]
FREE_EVERYDAY = [
    "parking is free after 6",
    "the museum is free on sundays",
    "kids eat free on tuesdays at that place",
    "shipping was free so i got two",
    "refills are free there",
    "the bus is free {time} because of the parade",
    "the zoo is free for kids under 3",
    "the concert in the park is free {time}",
    "my first checked bag was free",
    "the library has free wifi if yours is down",
    "returns are free so just send it back",
    "the clinic does free flu shots {time}",
    "the pool is free for residents",
    "lunch is free on fridays at my job",
    "the tutoring center is free for students",
    "the second one was free so i got you one",
    "admission was free {time} so we took the kids",
    "the gym gave me a free week to try it",
    "the oil change was free with the tires",
    "the yoga class in the park is free {time}",
    "the trial was free so i canceled before it renewed",
    "street parking is free on sundays",
    "the carwash was free with a fill up",
    "the bookstore event is free, no tickets needed",
]
FREE_IDIOM = [
    "is the {food} gluten free? {name} cant have gluten",
    "got the sugar free kind for grandpa",
    "use hands free while driving please",
    "the new car has hands free calling",
    "i finally feel free after finals",
    "{name} is such a free spirit",
    "he made both free throws to win the game!!",
    "free throw contest at the gym {time}",
    "the team signed a new free agent",
    "tax free weekend starts friday, need school shoes",
    "duty free at the airport had good chocolate",
    "got a free ride home from {name}",
    "trying to free up some space on my phone",
    "can you free up some time {time} to help with taxes",
    "the bird got out of the cage and is flying free in the house lol",
    "she broke free from the leash and ran to the neighbors",
    "dairy free cheese is not it",
    "the apartment is pet free so we cant bring the dog",
    "smoke free building, gotta go outside",
    "we let the fish go free in the lake",
    "my weekend is stress free for once",
    "i got a free upgrade to a bigger room",
    "nut free snacks only for {name}'s class",
    "the kids had free time after lunch",
    "caffeine free tea for {family}",
    "it was a free for all at the buffet lol",
]

TEMPLATES = {
    "feel_free": FEEL_FREE,
    "free_time": FREE_TIME,
    "free_food_event": FREE_FOOD_EVENT,
    "free_everyday": FREE_EVERYDAY,
    "free_idiom": FREE_IDIOM,
}

EMOJI = ["😂", "❤️", "🙏", "😊", "👍", "🍕", "🤣", "💕", "🎉", "😅", "🙌", "☕"]
OPENERS = ["", "", "", "hey ", "hi ", "omg ", "btw ", "fyi ", "yo ", "ok so ", "also "]
CLOSERS = ["", "", "", "", " thanks!", " love you", " see you soon", " lmk", " :)", " ty"]


def fill(r: random.Random, template: str) -> str:
    t1, t2 = r.sample(TIMES, 2)
    return template.format(name=r.choice(NAMES), family=r.choice(FAMILY), time=t1, time2=t2,
                           food=r.choice(FOODS), place_food=r.choice(PLACES_FOOD),
                           event=r.choice(EVENTS), fridge=r.choice(FRIDGE))


def style(r: random.Random, text: str) -> str:
    text = r.choice(OPENERS) + text
    if not text.endswith("?") and not text.endswith("lol"):
        text += r.choice(["", "", ".", "!", "!!", "..."])
    text += r.choice(CLOSERS)
    mode = r.random()
    if mode < 0.15:
        text = text.upper()   # caps must not make "free" look like spam either
    elif mode < 0.55:
        text = text.lower()
    else:
        text = text[:1].upper() + text[1:]
    if r.random() < 0.25:
        text += " " + "".join(r.choice(EMOJI) for _ in range(r.randrange(1, 3)))
    return re.sub(r"\s+", " ", text).strip()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9$]+", " ", s.lower()).strip()


def row(message: str, scenario: str) -> dict:
    return {
        "id": "s" + hashlib.sha1(f"freeham|train|{message}".encode("utf-8")).hexdigest()[:12],
        "message": message,
        "label_class": 0,
        "category_name": "Ham",
        "ftc_subcategory": 0,
        "label_method": "ham",
        "label_confidence": 1.0,
        "is_spam": 0,
        "source": SOURCE,
        "style": "sms",
        "is_synthetic": True,
        "gen_method": "template",
        "parent_id": "",
        "split": "train",
        "scenario": scenario,
    }


def existing_keys(data_dir: Path) -> set[str]:
    """Normalized texts already in the dataset, so no generated row repeats one."""
    seen: set[str] = set()
    for name in ("scam_categories_100k.csv", "potential_threat_synthetic.csv", "potential_threat_eval.csv"):
        path = data_dir / name
        if path.exists():
            with path.open(encoding="utf-8", newline="") as f:
                seen.update(norm(r["message"]) for r in csv.DictReader(f))
    return seen


def build(rng: random.Random, reserved: set[str]) -> list[dict]:
    rows: list[dict] = []
    seen = set(reserved)
    for scenario, n in COUNTS.items():
        made = tries = 0
        while made < n and tries < n * 200:
            tries += 1
            msg = style(rng, fill(rng, rng.choice(TEMPLATES[scenario])))
            key = norm(msg)
            if key in seen or not re.search(r"\bfree\b", msg, re.I):
                continue
            seen.add(key)
            rows.append(row(msg, scenario))
            made += 1
        if made < n:
            raise SystemExit(f"{scenario}: only {made}/{n} unique rows; add templates")
    rng.shuffle(rows)
    return rows


def main() -> None:
    here = Path(__file__).resolve().parent
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else here
    out.mkdir(parents=True, exist_ok=True)
    rows = build(random.Random(SEED), existing_keys(here))
    with (out / "free_ham_synthetic.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"free_ham_synthetic.csv: {len(rows)} rows, all label 0")


if __name__ == "__main__":
    main()
