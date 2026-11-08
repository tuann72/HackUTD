#!/usr/bin/env python3
"""Build the Potential Threat synthetic dataset (proposed label 8) and its held-out eval file.

Threat, coercion and fake-emergency extortion texts such as
"MOM IM DYING RIGHT NOW GIVE ME $900 OR I EXPLODE" are almost absent from
scam_categories_100k_full.csv, and short ALL-CAPS texts there are mostly ham. This script
writes template-generated threat rows plus hard negatives (label 0: genuine urgent family
texts, small casual money asks, harmless "dying"/"kill" slang) so a model can't learn
"caps = threat" or "amount = threat".

Stdlib only, no network, fixed seed: two runs give byte-identical files.

    python3 -I data/build_threat_synthetic.py            # writes next to this script
    python3 -I data/build_threat_synthetic.py <out_dir>

Outputs (same columns as scam_categories_100k_full.csv, plus `scenario`):
  potential_threat_synthetic.csv  ~4,100 rows, all split=train, is_synthetic=True
  potential_threat_eval.csv       ~100 hand-written-style rows, split=threat_eval (never train)

Labels here follow the proposal: 8 = Potential Threat, 0 = Ham. Label 8 is NOT yet in
scam_categories.csv; see docs/features/potential-threat-data.md.
"""

from __future__ import annotations

import csv
import hashlib
import random
import re
import sys
from pathlib import Path

SEED = 20261108
THREAT_LABEL = 8
THREAT_NAME = "Potential Threat"

COLUMNS = ["id", "message", "label_class", "category_name", "ftc_subcategory", "label_method",
           "label_confidence", "is_spam", "source", "style", "is_synthetic", "gen_method",
           "parent_id", "split", "scenario"]

# Rows per scenario. Threats ~65%, hard negatives ~35%.
THREAT_COUNTS = {
    "family_emergency": 450,
    "loved_one_danger": 450,
    "kidnap_ransom": 400,
    "physical_threat": 400,
    "blackmail": 350,
    "hitman_stalker": 300,
    "self_harm_coercion": 300,
}
HAM_COUNTS = {
    "urgent_family": 500,
    "casual_money": 450,
    "harmless_slang": 300,
    "caps_excitement": 200,
}

# ---------------------------------------------------------------- slot values

PARENT = ["mom", "mum", "mommy", "ma", "dad", "daddy", "pops", "grandma", "grandpa", "nana",
          "granny", "auntie", "uncle"]
LOVED = ["wife", "husband", "son", "daughter", "kid", "kids", "mother", "father", "mom", "dad",
         "grandson", "granddaughter", "girlfriend", "boyfriend", "brother", "sister", "baby",
         "family", "children", "little girl", "little boy"]
NAMES = ["jake", "emily", "carlos", "maria", "tyler", "ashley", "kevin", "jess", "danny", "sofia",
         "mike", "nina", "jordan", "lucy", "omar", "priya", "ben", "chloe", "luis", "hannah"]
PLACES = ["mexico", "the border", "a motel", "jail", "the police station", "a warehouse",
          "the hospital", "cancun", "the airport", "downtown"]
EMOJI_THREAT = ["😡", "🔪", "💀", "⚠️", "‼️", "⏰", "💣", "🙏", "😭", "🚨", "😠", "🩸"]
EMOJI_HAM = ["😂", "❤️", "🙏", "😭", "👍", "🥺", "😅", "🍕", "🤣", "💕", "😩", "🎉"]
HANDLE_WORDS = ["cash", "money", "fast", "king", "real", "help", "boss", "bigj", "lil", "gold"]

THREAT_URGENCY = ["RIGHT NOW", "right now", "NOW", "asap", "in the next hour", "within 30 minutes",
                  "tonight", "before midnight", "in 1 hour", "today", "immediately", "in 20 min",
                  "rn", "this minute", "before 6pm", "no excuses"]
NO_POLICE = ["dont call the police", "no cops", "dont tell anyone", "if you call police its over",
             "tell nobody", "keep your mouth shut", "dont hang up", "dont call anyone",
             "police = bad idea", "we are watching your phone"]


def amount(rng: random.Random, lo: int, hi: int) -> str:
    """A money amount in one of the formats scammers and people actually type."""
    steps = [s for s in (5, 10, 20, 25, 50, 100, 500) if s <= max(lo, 5)]
    # Mostly round numbers ($900, $2,500), sometimes odd ones ($1,150).
    step = steps[-1] if rng.random() < 0.7 else rng.choice(steps)
    n = rng.randrange(lo, hi + 1, step) if hi > lo else lo
    n = max(n, lo)
    fmts = ["${n}", "{n}$", "{n} dollars", "${n}.00", "{n} usd", "$ {n}", "{n} bucks", "{n}$$",
            "${c}", "{c}$", "USD {n}", "{n} dollar"]
    if n >= 1000:
        fmts += ["{k}k", "${k}k", "{k}K"]
    f = rng.choice(fmts)
    k = f"{n / 1000:g}"
    return f.format(n=n, c=f"{n:,}", k=k)


def rail(rng: random.Random) -> str:
    handle = rng.choice(HANDLE_WORDS) + rng.choice(["", "_", ""]) + str(rng.randrange(10, 999))
    wallet = "".join(rng.choice("abcdefghjkmnpqrstuvwxyz023456789") for _ in range(rng.randrange(18, 30)))
    return rng.choice([
        "in apple gift cards", "in google play cards", "in steam cards", "in target gift cards",
        "itunes cards, send pics of the codes", "gift cards and text me the codes",
        "on zelle", "zelle to this number", f"cashapp ${handle}", f"on cash app to ${handle}",
        f"venmo @{handle}", f"on venmo @{handle}", f"in bitcoin to bc1q{wallet}",
        f"btc to bc1{wallet}", "in crypto", f"usdt to T{wallet}", "by western union",
        "western union to " + rng.choice(PLACES), "by wire transfer", "moneygram",
        "paypal friends and family", "by bank transfer",
    ])


def maybe(rng: random.Random, p: float, s: str) -> str:
    return s if rng.random() < p else ""


# ---------------------------------------------------------------- threat templates
# Each template is a function of rng returning raw text, before case/typo/emoji noise.

def t_family_emergency(r: random.Random) -> str:
    p, amt, u = r.choice(PARENT), amount(r, 200, 3000), r.choice(THREAT_URGENCY)
    harm = r.choice(["they will kill me", "they're gonna hurt me", "im dying", "i will die",
                     "they said they'll break my hands", "they have a gun to my head",
                     "im bleeding bad", "i wont make it", "they will cut my finger off",
                     "im going to die here", "they'll shoot me", "i explode"])
    return r.choice([
        f"{p} its me, {harm} if you dont send {amt} {u}",
        f"{p} please {harm} send {amt} {rail(r)} {u}",
        f"{p} im in trouble, i owe these guys {amt} and {harm}. {r.choice(NO_POLICE)}",
        f"{p} help me {harm} give me {amt} {u}",
        f"{p} IM DYING RIGHT NOW GIVE ME {amt} OR {harm}",
        f"its me {r.choice(NAMES)}, new phone. {p} {harm} unless i pay {amt} {u}, send it {rail(r)}",
        f"{p} i got arrested in {r.choice(PLACES)}, the guard says {harm} unless bail {amt} is paid {u}",
        f"{p} dont ask questions just send {amt} {rail(r)} or {harm}",
        f"{p}!! {harm}!! need {amt} {u} please please",
        f"{p} its me i crashed the car into a guys truck, he says {harm} if i dont pay {amt} cash {u}",
        f"{p} please dont tell dad. i need {amt} {u} or {harm}",
        f"hey {p}, phone broke, this is my friends. {harm} if i dont get {amt} {rail(r)}",
    ])


def t_loved_one_danger(r: random.Random) -> str:
    who, amt, u = r.choice(LOVED), amount(r, 200, 5000), r.choice(THREAT_URGENCY)
    return r.choice([
        f"YOUR {who} IS IN DANGER GIVE ME {amt}",
        f"your {who} is in danger. send {amt} {rail(r)} {u} or you will regret it",
        f"we are with your {who} right now. {amt} {u} or something bad happens",
        f"your {who} got hurt and is with us. pay {amt} {u} if you want them safe. {r.choice(NO_POLICE)}",
        f"if you love your {who} you will send {amt} {rail(r)} {u}",
        f"your {who} wont come home tonight unless you pay {amt}",
        f"i know what school your {who} goes to. {amt} {u} {rail(r)}",
        f"your {who} owes us {amt}. pay {u} or we hurt them",
        f"your {who} is in big danger, only {amt} can fix it. {u}",
        f"something will happen to your {who} {u} if you dont send {amt}",
        f"your {who} is not safe. send {amt} and nobody gets hurt",
        f"listen carefully. your {who} is in trouble with us. {amt} {rail(r)}. {r.choice(NO_POLICE)}",
    ])


def t_kidnap_ransom(r: random.Random) -> str:
    who, amt, u = r.choice(LOVED), amount(r, 500, 9000), r.choice(THREAT_URGENCY)
    name = r.choice(NAMES)
    return r.choice([
        f"we have your {who}. send {amt} {rail(r)} {u} or you never see them again",
        f"we kidnapped {name}. {amt} {u}. {r.choice(NO_POLICE)}",
        f"your {who} is with us. ransom is {amt}. {rail(r)}. {r.choice(NO_POLICE)}",
        f"we took your {who} from {r.choice(PLACES)}. pay {amt} {u} or we hurt them",
        f"{name} is tied up next to me. {amt} {rail(r)} {u} if you want {name} back alive",
        f"this is not a joke we have {name}. {amt} {u}. send proof of payment",
        f"we are holding your {who}. {amt} {u} or we start hurting",
        f"ransom {amt} for your {who}. {rail(r)}. you have {r.choice(['1 hour', '2 hours', '30 min', 'til midnight'])}",
        f"if you want to see your {who} again send {amt} {u}",
        f"your {who} is in our car. dont call anyone. {amt} {rail(r)}",
        f"{who} kidnapped. pay {amt} {u}. we know your address",
    ])


def t_physical_threat(r: random.Random) -> str:
    amt, u = amount(r, 100, 4000), r.choice(THREAT_URGENCY)
    harm = r.choice(["we break your legs", "you get hurt", "your house burns", "your car is gone",
                     "we come to your house", "you will bleed", "we will find you",
                     "you wont walk again", "we hurt you bad", "your windows get smashed",
                     "you are dead", "its your funeral"])
    return r.choice([
        f"pay {amt} {u} or {harm}",
        f"you owe {amt}. {u} or {harm}",
        f"send {amt} {rail(r)} {u} or {harm}",
        f"last warning. {amt} {u} or {harm}",
        f"we know you have the money. {amt} or {harm}. {r.choice(NO_POLICE)}",
        f"give me {amt} {u} or {harm}",
        f"{amt} by tonight or else",
        f"you have {r.choice(['24 hours', '1 hour', 'till 9pm', '3 hours'])} to send {amt} or {harm}",
        f"i am outside your house. {amt} {rail(r)} or {harm}",
        f"this is your only warning, {amt} {u}, or {harm}",
        f"pay up {amt} or else. {r.choice(NO_POLICE)}",
    ])


def t_blackmail(r: random.Random) -> str:
    amt, u = amount(r, 300, 5000), r.choice(THREAT_URGENCY)
    what = r.choice(["your private photos", "the video of you", "your messages", "your browser history",
                     "screenshots of your chats", "your secret", "what you did last night",
                     "your pictures", "the recording", "your files"])
    to = r.choice(["your wife", "your boss", "your family", "all your contacts", "your church",
                   "your kids school", "facebook", "your husband", "your coworkers", "everyone"])
    return r.choice([
        f"i have {what}. pay {amt} {rail(r)} or i send it to {to}",
        f"send {amt} {u} or {to} sees {what}",
        f"i hacked your phone and got {what}. {amt} in bitcoin {u} or {to} gets everything",
        f"{amt} or {what} goes to {to}. clock is ticking",
        f"you have {r.choice(['48 hours', '24 hours', '12 hours', 'until tonight'])}. {amt} {rail(r)} or i post {what}",
        f"i know your secret. {amt} {u} or i tell {to}",
        f"dont ignore me. {what} will be sent to {to} unless i get {amt}",
        f"pay {amt} and i delete {what}. dont pay and {to} finds out",
        f"i recorded you. {amt} {rail(r)} {u} or {to} watches it",
    ])


def t_hitman_stalker(r: random.Random) -> str:
    amt, u = amount(r, 500, 8000), r.choice(THREAT_URGENCY)
    return r.choice([
        f"i was paid to kill you. send {amt} {rail(r)} and i cancel the job",
        f"someone paid me to hurt you. pay {amt} {u} and i walk away",
        f"i know where you live. {amt} {u} or i come visit",
        f"i know where you live and where you work. {amt} {rail(r)}",
        f"we have been watching you for weeks. {amt} {u} or you disappear",
        f"there is a contract on your life. {amt} gets it cancelled. {r.choice(NO_POLICE)}",
        f"i see you right now. nice {r.choice(['jacket', 'car', 'house', 'porch'])}. {amt} {u}",
        f"i am a hitman. your {r.choice(LOVED)} wants you dead. pay me {amt} more and you live",
        f"i know your address. {amt} {rail(r)} or you will see me {u}",
        f"we know where your {r.choice(LOVED)} sleeps. {amt} {u}",
        f"you are being followed. {amt} or we finish it {u}",
    ])


def t_self_harm_coercion(r: random.Random) -> str:
    amt, u = amount(r, 100, 3000), r.choice(THREAT_URGENCY)
    p = r.choice(PARENT + ["babe", "bro", "sis", "honey", "baby"])
    harm = r.choice(["i explode", "i end it", "im gonna hurt myself", "i jump", "i wont be here tomorrow",
                     "you will never see me again", "i do something bad", "its your fault what happens",
                     "i die", "im done", "i take all the pills"])
    return r.choice([
        f"{p} GIVE ME {amt} {u} OR {harm}",
        f"{p} send {amt} {u} or {harm}",
        f"if you dont send {amt} {rail(r)} {u} {harm}",
        f"{amt} {u} {p} or {harm}, dont test me",
        f"{p} i need {amt} {u} or {harm} and its on you",
        f"{p} im serious send {amt} or {harm}",
        f"give me {amt} or {harm}. last message",
        f"{p} {amt} {rail(r)} {u}. or {harm}",
    ])


# ---------------------------------------------------------------- hard negatives (label 0)

def h_urgent_family(r: random.Random) -> str:
    p, name = r.choice(PARENT), r.choice(NAMES)
    place = r.choice(["st marys", "the ER", "urgent care", "memorial hospital", "the clinic",
                      "school", "the nurse's office", "the station", "work", "the mall"])
    return r.choice([
        f"{p} call me asap", f"{p} CALL ME", f"{p} pick up your phone", f"{p} where are you??",
        f"{p} im at the hospital, broke my arm, can you pick me up",
        f"{p} im at {place}, {name} fell but they're ok. come when you can",
        f"{p} call me when you get this, its about grandpa",
        f"{p} im ok, little car accident but everyone is fine. phone dying, call u later",
        f"{p} my phone is about to die, pick me up at {r.choice(['6', '7', '9', '5:30'])} at {place}",
        f"{p} are you ok?? i saw the news about the storm",
        f"{p} we're at {place}, {name} needs stitches, nothing serious",
        f"{p} help i locked myself out, can you bring the spare key",
        f"{p} the basement is flooding what do i do",
        f"{p} is grandma ok? call me back",
        f"{p} i missed the bus, can you come get me",
        f"{p} dont freak out but i got a flat tire, im safe at the gas station",
        f"{p} urgent: did you leave the stove on??",
        f"{p} the dog got out, help me look",
        f"{p} im scared of the storm can you come home early",
        f"{p} {name} is sick, can you grab medicine on the way home",
        f"{p} its an emergency, i need the wifi password lol",
        f"{p} im home safe, sorry i didnt text",
        f"{p} call the school they said i can leave early, i have a fever",
        f"emergency!! {name} is having the baby, come to {place}",
    ])


def h_casual_money(r: random.Random) -> str:
    small = amount(r, 5, 80)
    mid = amount(r, 100, 1500)
    p, name = r.choice(PARENT), r.choice(NAMES)
    app = r.choice(["venmo", "zelle", "cashapp", "cash app", "paypal", "apple pay"])
    return r.choice([
        f"can you {app} me {small} for pizza lol", f"{app} me {small} for the uber?",
        f"i owe you {small} for the tickets, sending now", f"sent you {small} on {app}",
        f"{p} can you send me {small} for books? no rush", f"rent is {mid} this month, ill send my half friday",
        f"{name} paid me back {small}, thanks for covering", f"split the dinner? its {small} each",
        f"hey can u {app} me {small} til payday, ill pay u back", f"{p} thanks for the {small}!!",
        f"got grandma a {small} target gift card for her bday", f"the car repair was {mid}, insurance covers most",
        f"just paid the electric bill, {mid}", f"{p} can i borrow {small} for gas, ill pay you sunday",
        f"{app} request sent for {small}, its for the concert", f"the plumber wants {mid} cash, is that normal?",
        f"{p} i sent {name} {small} for his birthday", f"can u spot me {small} for lunch",
        f"refund came in, {mid} back from the airline", f"{name} wants {small} for the team jersey",
        f"tuition deposit is {mid}, due next month", f"we raised {mid} at the bake sale!!",
    ])


def h_harmless_slang(r: random.Random) -> str:
    name = r.choice(NAMES)
    return r.choice([
        "IM DYING THIS VIDEO IS SO FUNNY", "im dying lol", "this traffic is killing me",
        "i'm literally dying of laughter", f"{name} you're killing me with these memes",
        "dying to see you this weekend", "my feet are killing me after that shift",
        "the dog is in danger of eating the whole cake lol", "kill the lights when you leave pls",
        f"im kidnapping {name} for lunch tomorrow", "my phone is dying, text you later",
        "I WILL KILL YOU IF YOU SPOIL THE FINALE lol", "that test killed me",
        "we're in danger of being late, leave now", "danger zone: mom is cleaning the garage",
        "the plants are dying, did anyone water them", "this heat is going to kill me",
        "i would die for this pasta", f"{name} is holding the remote hostage again",
        "ransom note: give back my hoodie or no more cookies", "i'll murder this burger",
        "i explode if i eat one more bite", "the battery is dead, can you jump the car",
        "you scared me to death!!", "dead tired, going to bed", "that shot was a killer",
        "we owe you big time, dinner is on us", "pay me back whenever lol no pressure",
    ])


def h_caps_excitement(r: random.Random) -> str:
    p, name = r.choice(PARENT), r.choice(NAMES)
    return r.choice([
        f"{p} I GOT THE JOB", f"{p} I PASSED MY DRIVING TEST", f"{p} WE WON THE GAME",
        f"OMG {name} IS ENGAGED", f"{p} I GOT INTO COLLEGE", f"HAPPY BIRTHDAY {p}!!!",
        f"{p} GUESS WHAT", f"{p} LOOK OUTSIDE ITS SNOWING", f"{name} GOT A PUPPY",
        f"{p} I GOT A RAISE, {amount(r, 100, 900)} MORE A MONTH", f"WE'RE HAVING A BABY",
        f"{p} TURN ON CHANNEL 5 RIGHT NOW", f"{p} I FINISHED MY THESIS", f"I LOVE YOU {p}",
        f"{p} I FOUND YOUR RING", f"{p} THE PACKAGE CAME", f"CALL ME I HAVE NEWS",
    ])


THREAT_GEN = {
    "family_emergency": t_family_emergency, "loved_one_danger": t_loved_one_danger,
    "kidnap_ransom": t_kidnap_ransom, "physical_threat": t_physical_threat,
    "blackmail": t_blackmail, "hitman_stalker": t_hitman_stalker,
    "self_harm_coercion": t_self_harm_coercion,
}
HAM_GEN = {
    "urgent_family": h_urgent_family, "casual_money": h_casual_money,
    "harmless_slang": h_harmless_slang, "caps_excitement": h_caps_excitement,
}

# ---------------------------------------------------------------- noise (same for both labels)

SLANG = [(r"\byou\b", "u"), (r"\byour\b", "ur"), (r"\bplease\b", "plz"), (r"\bplease\b", "pls"),
         (r"\bare\b", "r"), (r"\bim\b", "i'm"), (r"\bdont\b", "don't"), (r"\bright now\b", "rn"),
         (r"\bbecause\b", "bc"), (r"\btonight\b", "2nite"), (r"\bto\b", "2"), (r"\bfor\b", "4")]
MISSPELL = {"wife": ["wiffe", "wif", "wyfe"], "danger": ["dangr", "dangerr", "danjer"],
            "money": ["mony", "monney"], "please": ["pleas", "pleeease"], "right": ["rite"],
            "police": ["polise", "polic"], "kidnapped": ["kidnaped", "kidnappd"],
            "daughter": ["daugther", "doughter"], "send": ["sned", "sennd"],
            "hospital": ["hospitol", "hosptal"], "tonight": ["tonite"], "really": ["realy"]}


def typo(r: random.Random, text: str) -> str:
    words = text.split(" ")
    idx = [i for i, w in enumerate(words) if sum(c.isalpha() for c in w) >= 3]
    if not idx:
        return text
    i = r.choice(idx)
    w = words[i]
    low = w.lower().strip(".,!?")
    if low in MISSPELL and r.random() < 0.6:
        words[i] = w.lower().replace(low, r.choice(MISSPELL[low]))
        return " ".join(words)
    pos = [j for j, c in enumerate(w) if c.isalpha()]
    j = r.choice(pos)
    kind = r.random()
    if kind < 0.5:  # letter doubling ("WIFFE")
        w = w[:j + 1] + w[j] + w[j + 1:]
    elif kind < 0.75 and len(pos) > 3:  # dropped letter
        w = w[:j] + w[j + 1:]
    elif j + 1 < len(w) and w[j + 1].isalpha():  # swapped neighbors
        w = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    words[i] = w
    return " ".join(words)


def noise(r: random.Random, text: str, emoji_pool: list[str]) -> str:
    if r.random() < 0.4:
        pat, rep = r.choice(SLANG)
        text = re.sub(pat, rep, text, count=r.choice([1, 3]))
    for _ in range(r.choices([0, 1, 2, 3], weights=[55, 30, 11, 4])[0]):
        text = typo(r, text)
    if r.random() < 0.3:
        # Drop commas, apostrophes and periods, but keep decimal points ("$7500.00", "2.5k").
        text = re.sub(r"(?<!\d)[.,]|[.,](?!\d)|'", "", text)
    text = text.rstrip(".!? ") + r.choice(["", "", ".", "!", "!!", "!!!", "?", "??", "?!", "...", " !!"])
    mode = r.random()
    if mode < 0.35:
        text = text.upper()
    elif mode < 0.65:
        text = text.lower()
    elif mode < 0.85:
        text = text[:1].upper() + text[1:]
    if r.random() < 0.3:
        e = "".join(r.choice(emoji_pool) for _ in range(r.randrange(1, 4)))
        text = (e + " " + text) if r.random() < 0.15 else (text + " " + e)
    return re.sub(r"\s+", " ", text).strip()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9$]+", " ", s.lower()).strip()


# ---------------------------------------------------------------- held-out eval rows
# Hand-written style, NOT from the templates above. Never train on these.

EVAL_THREAT = [
    "MOM IM DYING RIGHT NOW GIVE ME $900 OR I EXPLODE",
    "YOUR WIFFE IS IN DANGER GIVE ME 500$",
    "grandma its me danny. i'm locked up and the officer says if i dont pay $2,000 bail tonight they move me to the big jail. please dont tell mom",
    "Your son was in an accident with my brother's car. He is with us now. Wire $3500 or he doesn't leave",
    "DAD THEY TOOK MY PHONE AND MY PASSPORT. THEY WANT 1500 DOLLARS OR THEY HURT ME. PLEASE",
    "we got ur daughter. 5k btc. no cops or u know what happens",
    "I know you live on the corner house with the blue door. $800 in google play cards by 9 or I come knocking",
    "hello. someone hired me to end your life. i'm giving you a chance. 2000 usd and i forget your name",
    "I have the video from your webcam. Pay 1200$ in Bitcoin within 48 hours or every contact in your phone gets it",
    "babe if u dont send me 300 rn i swear i'll hurt myself and its all on u",
    "uncle its me carlos new number. the guys i owe say they will break my fingers. need 700 on zelle ASAP",
    "YOUR HUSBAND IS WITH US. HE IS BLEEDING. SEND 4000 OR HE DIE",
    "Pay what you owe. $650 by friday or your car windows are the first thing to go",
    "mommy pls help me they r going to kill me i need 1k in apple cards send the codes",
    "This is your last warning. 2500 dollars or your family finds out everything. Cashapp $realboss77",
    "IF YOU WANT YOUR KID BACK SEND 9000$ WESTERN UNION. YOU HAVE 2 HOURS",
    "nana i'm in tijuana and these men say i owe them. they have a knife. send 1200 please dont call anyone",
    "we know where your kids go to school. $1,000 venmo @gold_481 tonight",
    "GIVE ME 200 DOLLARS OR I BURN YOUR HOUSE",
    "your grandson is in serious danger. pay 3000 to the lawyer by wire before 5pm and he will be safe",
    "i hacked ur instagram and have ur dms. $400 or i send them to ur mom",
    "Pops its me i messed up big. they want $5,000 or they say im dead. dont call the cops",
    "SEND 750$ NOW OR U WILL NEVER SEE UR DOG AGAIN",
    "Ur sister owes my boss money. 1500 cash app or she gets hurt tonight",
    "i'm watching you right now. nice red jacket. $600 in steam cards or we talk in person",
    "mom i swear if u dont give me 500 im jumping off the bridge",
    "We are holding Sofia. Proof she is alive attached. $8,000 USDT. Do not involve police",
    "DAD IM DYING HELP SEND MONY 800$ PLZ PLZ",
    "your daugther was in a crash and the other driver says pay $2k or he breaks her legs",
    "A hit has been placed on you. For 3k I can make it disappear. Reply fast",
    "Give me $350 or I post the pictures. You know which ones",
    "HONEY THEY GOT ME. 1,000 IN TARGET GIFT CARDS OR THEY SAY I DIE. HURRY",
    "pay 450$ to this zelle or ur boss gets the screenshots tomorrow morning",
    "grandpa please its me, the man says he'll shoot me if i dont get 2500 dollars. dont hang up",
    "U HAVE 1 HOUR. 900 DOLLARS. OR UR FAMILY PAYS",
    "your wife is not answering because she is with us. 6000 usd btc",
    "Mom it's Jess, I'm in big trouble and they're going to hurt me unless you send $1,200 on Venmo right now",
    "i know your address and your schedule. 1500 bucks or you'll regret leaving the house",
    "brother send 300 now or i swear something bad happens to me tonight",
    "Your kid's teacher won't save them. $5k, no police, you have until midnight",
    "THEY WILL KILL MY BABY IF I DONT PAY 2000 PLEASE SEND ANYTHING CASHAPP",
    "if i dont get 600$ by tonight im going to do something i cant take back. u decide",
    "we took your mother from the parking lot. 7500 dollars. we're watching your phone",
    "pay up 1k or the whole church sees what you did",
    "Auntie please, they caught me at the border and say they hurt me unless 3,000 dollars. Western Union only",
    "your boyfriend is tied up in my garage lol not a joke. $2,000 zelle",
    "this is not spam. i have been paid to hurt you. $1,800 bitcoin and the job is cancelled",
    "MOM SEND 400 NOW OR I EXPLODE I SWEAR",
    "Your children are in danger. Send $2500 in Apple cards and text me the codes. Tell no one",
    "Dad i owe the wrong ppl 900. they said they'll break my legs friday. pls",
    "I see your car in the driveway. 1000 dollars or the tires are just the start",
    "hey its me, ur son, they have a gun on me. 3k now. dont call",
    "Give me 250 dollars or your little girl gets hurt",
    "send me $1,000 or i send your search history to your wife",
    "YOU HAVE 30 MIN TO SEND 5K OR WE HURT HIM",
    "granny they are going to cut me if i dont pay 1500. send to cashapp $lil882",
    "Your family's safety costs $3,000. Pay by wire before 6pm",
    "i will hurt myself tonight unless you venmo me 200. dont ignore this",
]

EVAL_HAM = [
    "MOM CALL ME ASAP",
    "dad im at the hospital, broke my arm, can you pick me up",
    "can you venmo me $20 for pizza lol",
    "IM DYING 😂😂 DID YOU SEE THAT VIDEO",
    "grandma are you ok? call me back when you can",
    "MOM I PASSED MY TEST!!!",
    "can u zelle me 15$ for the uber, ill pay u back friday",
    "dad the car broke down on 75, im safe, waiting for the tow",
    "Mom it's Jess, I'm fine, just lost my charger. Call you tonight",
    "rent is $900 this month, i'll send my half on the 1st",
    "my phone is dying pick me up at 6 by the library",
    "WE WON STATE!!! 🏆",
    "you're killing me with these puns",
    "honey can you grab milk on the way home",
    "the dog is in danger of eating the entire cake lol hurry",
    "im kidnapping you for brunch sunday, no excuses",
    "DAD PICK UP UR PHONE ITS ABOUT GRANDMA SHES OK BUT CALL",
    "sent u $40 on cashapp for the concert tix",
    "mom can you send me 50 for textbooks? no rush at all",
    "this traffic is killing me, be there in 20",
    "Grandpa we're at the ER with Lucy, just a sprained wrist, nothing serious",
    "I WILL END YOU IF YOU SPOIL THE FINALE",
    "car repair was 600$, insurance covered most of it",
    "uncle can you help me move saturday? pizza on me",
    "Emergency!!! I need your lasagna recipe",
    "babe the basement flooded, plumber wants 350 cash, is that normal?",
    "mom im home safe, sorry i forgot to text",
    "HAPPY BIRTHDAY NANA I LOVE YOU",
    "split dinner? 32 each",
    "i got grandma a $25 apple gift card for her birthday",
    "OMG I GOT THE JOB 😭😭",
    "my feet are killing me after that double shift",
    "dad can you spot me $30 for gas till payday",
    "the plants are dying, did anyone water them??",
    "Kevin is holding the remote hostage again lol",
    "MOM WHERE ARE YOU. dinner is ready",
    "danger zone: dad is grilling again",
    "can i borrow 100$ for the trip deposit, ill pay you back next week",
    "we raised $1,200 at the bake sale!!",
    "the battery is dead can you come jump the car",
    "Ma call me when u see this, its good news",
    "paid the electric bill, 140 dollars",
]


# ---------------------------------------------------------------- build

def row(message: str, label: int, scenario: str, split: str, method: str, gen: str, source: str) -> dict:
    return {
        "id": "s" + hashlib.sha1(f"threat|{split}|{message}".encode("utf-8")).hexdigest()[:12],
        "message": message,
        "label_class": label,
        "category_name": THREAT_NAME if label == THREAT_LABEL else "Ham",
        "ftc_subcategory": -1 if label == THREAT_LABEL else 0,
        "label_method": method,
        "label_confidence": 1.0,
        "is_spam": 1 if label == THREAT_LABEL else 0,
        "source": source,
        "style": "sms",
        "is_synthetic": True,
        "gen_method": gen,
        "parent_id": "",
        "split": split,
        "scenario": scenario,
    }


def build_train(rng: random.Random, reserved: set[str]) -> list[dict]:
    rows: list[dict] = []
    seen = set(reserved)
    plan = [(s, n, THREAT_GEN[s], THREAT_LABEL, EMOJI_THREAT) for s, n in THREAT_COUNTS.items()]
    plan += [(s, n, HAM_GEN[s], 0, EMOJI_HAM) for s, n in HAM_COUNTS.items()]
    for scenario, n, gen, label, pool in plan:
        made = tries = 0
        while made < n and tries < n * 50:
            tries += 1
            msg = noise(rng, gen(rng), pool)
            key = norm(msg)
            if key in seen:
                continue
            seen.add(key)
            rows.append(row(msg, label, scenario, "train", "template" if label else "ham",
                            "template", "synthetic_threat"))
            made += 1
        if made < n:
            raise SystemExit(f"{scenario}: only {made}/{n} unique rows; add templates")
    rng.shuffle(rows)
    return rows


def build_eval() -> list[dict]:
    out = [row(m, THREAT_LABEL, "eval_threat", "threat_eval", "manual", "handwritten",
               "synthetic_threat_eval") for m in EVAL_THREAT]
    out += [row(m, 0, "eval_ham", "threat_eval", "manual", "handwritten",
                "synthetic_threat_eval") for m in EVAL_HAM]
    return out


def write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    out.mkdir(parents=True, exist_ok=True)
    eval_rows = build_eval()
    keys = [norm(r["message"]) for r in eval_rows]
    if len(set(keys)) != len(keys):
        raise SystemExit("duplicate eval rows")
    train_rows = build_train(random.Random(SEED), set(keys))  # never reproduce an eval row
    write(out / "potential_threat_synthetic.csv", train_rows)
    write(out / "potential_threat_eval.csv", eval_rows)
    for name, rows in (("potential_threat_synthetic.csv", train_rows), ("potential_threat_eval.csv", eval_rows)):
        n8 = sum(r["label_class"] == THREAT_LABEL for r in rows)
        print(f"{name}: {len(rows)} rows, label 8 = {n8}, label 0 = {len(rows) - n8}")


if __name__ == "__main__":
    main()
