"""Clean the real spam/ham corpora, then top up with synthetic rows to 100k (50k spam / 50k ham).

Usage: python3 -I build_100k.py <data_root> <out_dir>

Outputs
  spam_ham_100k.csv          message,label,spam_type
  spam_ham_100k_full.csv     + source,style,is_synthetic,gen_method,parent_id,split,id
Every cleaned real row is kept. Synthetic rows are derived only from TRAIN-split
parents (or templates), so val/test are 100% real and leakage-free.
"""
import glob, hashlib, html, os, random, re, sys, unicodedata
import numpy as np
import pandas as pd

SEED = 42
rng = random.Random(SEED)
np.random.seed(SEED)
root, out_dir = sys.argv[1], sys.argv[2]
TARGET_PER_CLASS = 50_000
FRAUD_TARGET = 20_000          # of the 50k spam; rest is solicitation
MAX_AUG_PER_PARENT = 3

# ---------------------------------------------------------------- load
frames = []
s = pd.read_csv(os.path.join(root, "spam.csv"))  # spam2.csv is the same corpus re-encoded -> skipped
frames.append(pd.DataFrame({"message": s["Message"], "label": (s["Category"].str.lower() == "spam").astype(int),
                            "source": "sms_spam_collection", "style": "sms"}))
p = pd.read_csv(os.path.join(root, "spam1.csv"))
frames.append(pd.DataFrame({"message": p["text"], "label": 1, "source": "ph_sms_spam", "style": "sms"}))
for f in sorted(glob.glob(os.path.join(root, "haldonmez*/dataset/enron*.csv"))):
    try:
        e = pd.read_csv(f)
    except Exception:
        continue
    if "label_num" not in e.columns:
        continue  # git-lfs pointer
    frames.append(pd.DataFrame({"message": e["text"], "label": e["label_num"].astype(int),
                                "source": "enron_" + os.path.basename(f)[5:-4], "style": "email"}))
raw = pd.concat(frames, ignore_index=True)
raw["message"] = raw["message"].astype(str)
n_raw = len(raw)

# ---------------------------------------------------------------- clean
HTML_TAG = re.compile(r"</?(a|p|br|font|div|span|table|tbody|td|tr|th|b|i|u|html|head|body|img|center|style|meta)\b[^>]*>", re.I)
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏﻿]")
JUNK = {"#error!", "nan", "subject", "<<content not supported.>>"}

def clean_text(t, style):
    t = unicodedata.normalize("NFKC", t)
    t = html.unescape(t)
    t = HTML_TAG.sub(" ", t)
    t = CTRL.sub(" ", t)
    t = t.replace("�", " ")
    if style == "email":
        t = re.sub(r"\s+", " ", t)
        t = re.sub(r"(?:\b\d{1,2}\b ){6,}", " ", t)   # residue of stripped non-latin text: "10 11 11 12 ..."
        t = re.sub(r"\s+", " ", t)
    else:
        t = re.sub(r"[ \t]+", " ", t)
        t = re.sub(r"\s*\n\s*", "\n", t)
    return t.strip()

def norm_key(t):
    t = t.lower()
    t = re.sub(r"^subject\s+", "", t)
    return re.sub(r"[^a-z0-9]+", "", t)

stats = {}
df = raw.copy()
df["message"] = [clean_text(m, st) for m, st in zip(df.message, df["style"])]
df = df[~df.message.str.lower().isin(JUNK)]
stats["junk/placeholder"] = n_raw - len(df)
letters = df.message.str.count(r"[A-Za-z]")
bad = (letters == 0) | ((df["style"] == "email") & (df.message.str.len() > 40) & (letters / df.message.str.len() < 0.45))
bad |= (df["style"] == "email") & (df.message.str.split().str.len() < 3)
stats["no-text / garbage encoding"] = int(bad.sum()); df = df[~bad]
long_ = df.message.str.len() > 20_000
stats["length outliers >20k chars"] = int(long_.sum()); df = df[~long_]
df["key"] = df.message.map(norm_key)
conflict = df.groupby("key").label.transform("nunique") > 1
stats["conflicting-label duplicates"] = int(conflict.sum()); df = df[~conflict]
before = len(df)
df = df.drop_duplicates("key")
stats["exact/near duplicates"] = before - len(df)

# ---------------------------------------------------------------- spam_type rules
FRAUD = [
    r"verify (your|the|account|identity|here|now)", r"(account|identity|billing|information|re.?)verification", r"suspend", r"deactivat", r"restrict(ed)? ", r"locked", r"unusual (activity|sign)",
    r"security (key|alert|update|measure)", r"\botp\b", r"one.time.pin", r"(reset|confirm|verify|update|re.?enter|submit) (your )?(password|pin)", r"log ?in to your",
    r"update (your|here|the)", r"confirm your", r"account (has been|will be|is)", r"billing information",
    r"paypal", r"ebay account", r"online banking", r"internet banking", r"dear .{0,30}customer",
    r"(you|u) (have )?(won|been (selected|awarded|chosen))", r"\bwinner\b", r"lottery", r"lotto",
    r"\bawarded\b", r"prize", r"claim (code|no|your|now)", r"guaranteed.{0,20}(cash|prize|£)",
    r"selected to receive", r"await collection", r"to claim", r"unclaimed", r"nanalo",
    r"next of kin", r"beneficiar", r"inheritance", r"barrister", r"\bmillion (us )?(dollars|usd)",
    r"transfer (of )?(the )?(funds|sum)", r"diplomat", r"western union", r"money ?gram", r"bank draft",
    r"part.?time job", r"daily salary", r"earn .{0,15}(per|a|each|every) day", r"bawat araw",
    r"watching youtube", r"nanonood ng youtube", r"work from home", r"money transfer agent",
    r"payment processing", r"financial (manager|agent|representative)",
    r"overdue", r"penalt", r"legal (action|consequence)", r"traffic ticket", r"\btoll (fee|charge|violation|bill|payment|notice)", r"unpaid toll", r"parcel",
    r"package (could not|is|has been)", r"will (automatically )?renew", r"points (will )?expire",
    r"stock (alert|profile|pick)", r"investor alert", r"(stock|trading|ticker) symbol", r"symbol ?: ?[a-z]{3,5}\b", r"shares .{0,30}(target|price)",
    r"stox", r"\botc\b", r"\bpink sheets\b",
    # added: crypto / refund / impersonation patterns
    r"tax refund", r"refund of", r"new number.{0,40}send", r"guaranteed (returns|profit)", r"(btc|bitcoin|crypto|usdt).{0,40}(return|profit)",
]
FRAUD_RE = re.compile("|".join(FRAUD), re.I)
df["spam_type"] = np.where(df.label == 0, "ham",
                  np.where(df.message.map(lambda m: bool(FRAUD_RE.search(m))), "fraud", "solicitation"))
df["is_synthetic"] = False
df["gen_method"] = "original"
df["parent_id"] = ""
df["id"] = ["r" + hashlib.md5(k.encode()).hexdigest()[:12] for k in df.key]

# ---------------------------------------------------------------- split real data (stratified 80/10/10)
df["split"] = "train"
for _, g in df.groupby(["spam_type", "style"]):
    idx = g.index.to_numpy().copy(); np.random.shuffle(idx)
    n = len(idx); nv = int(round(n * 0.1))
    df.loc[idx[:nv], "split"] = "val"; df.loc[idx[nv:2 * nv], "split"] = "test"
real = df.reset_index(drop=True)
seen = set(real.key)

# ---------------------------------------------------------------- augmentation
SYN = {
 "free": ["complimentary", "no cost", "free of charge"], "win": ["get", "receive", "take home"], "won": ["received", "been awarded", "secured"],
 "prize": ["reward", "award", "cash prize"], "call": ["ring", "phone", "dial"], "now": ["today", "right away", "asap", "immediately"],
 "urgent": ["important", "immediate", "time sensitive"], "claim": ["collect", "redeem", "get"], "offer": ["deal", "promo", "promotion"],
 "money": ["cash", "funds"], "cash": ["money", "funds"], "account": ["acct", "profile"], "click": ["tap", "visit", "go to"],
 "customer": ["client", "user", "member"], "please": ["pls", "kindly"], "contact": ["reach", "message", "get in touch with"],
 "cheap": ["low cost", "affordable", "discount"], "save": ["cut", "reduce costs by"], "best": ["top", "finest", "greatest"],
 "buy": ["order", "purchase", "get"], "new": ["latest", "brand new"], "great": ["excellent", "amazing", "fantastic"],
 "today": ["this day", "now", "tonight"], "help": ["assist", "support"], "send": ["forward", "pass", "email"],
 "meeting": ["call", "session", "meet"], "tomorrow": ["tmr", "the next day", "tmrw"], "thanks": ["thank you", "thx", "cheers"],
 "attached": ["enclosed", "included"], "review": ["look over", "check", "go through"], "schedule": ["calendar", "plan"],
 "discuss": ["talk about", "go over", "cover"], "question": ["query", "issue"], "information": ["info", "details"],
 "know": ["hear", "be aware"], "get": ["grab", "pick up", "receive"], "home": ["back home", "at home"], "ok": ["okay", "k", "alright"],
 "okay": ["ok", "alright", "sure"], "yes": ["yeah", "yep", "yup"], "later": ["after", "in a bit", "later on"], "soon": ["shortly", "in a bit"],
 "good": ["nice", "great", "fine"], "sorry": ["apologies", "sry", "my bad"], "want": ["wanna", "would like"], "going": ["heading", "goin"],
 "think": ["guess", "reckon", "feel"], "need": ["have to", "gotta", "must"], "hi": ["hey", "hello", "hiya"], "hey": ["hi", "hello", "yo"],
 "number": ["no", "mobile number", "phone number"], "message": ["msg", "text", "sms"], "text": ["txt", "msg", "message"],
 "deposit": ["top up", "load", "fund"], "bonus": ["reward", "extra credit", "cashback"], "register": ["sign up", "join", "enroll"],
 "verify": ["confirm", "validate", "re-verify"], "update": ["refresh", "revalidate", "confirm"], "suspended": ["locked", "frozen", "on hold"],
 "immediately": ["right away", "at once", "now"], "price": ["cost", "rate"], "prices": ["rates", "costs"], "order": ["purchase", "buy"],
 "quality": ["grade", "standard"], "company": ["firm", "business", "organization"], "deal": ["agreement", "transaction"],
 "gas": ["natural gas", "volumes"], "volume": ["quantity", "volumes"], "forward": ["send", "pass along"], "regards": ["thanks", "best", "cheers"],
}
SMS_SPEAK = [(r"\byou\b", "u"), (r"\byour\b", "ur"), (r"\bare\b", "r"), (r"\bfor\b", "4"), (r"\bto\b", "2"), (r"\bplease\b", "pls"),
             (r"\btonight\b", "2nite"), (r"\bbefore\b", "b4"), (r"\bgreat\b", "gr8"), (r"\btext\b", "txt"), (r"\bthanks\b", "thx")]
SMS_EXPAND = [(r"\bu\b", "you"), (r"\bur\b", "your"), (r"\br\b", "are"), (r"\b4\b", "for"), (r"\b2\b", "to"), (r"\bpls\b", "please"), (r"\btxt\b", "text")]

def match_case(src, rep):
    if src.isupper() and len(src) > 1: return rep.upper()
    if src[:1].isupper(): return rep[:1].upper() + rep[1:]
    return rep

def synonym_replace(words, p):
    out = []
    for w in words:
        core = re.sub(r"\W+$", "", w); tail = w[len(core):]
        if core.lower() in SYN and rng.random() < p:
            out.append(match_case(core, rng.choice(SYN[core.lower()])) + tail)
        else:
            out.append(w)
    return out

def random_delete(words, p):
    if len(words) < 6: return words
    kept = [w for w in words if rng.random() > p]
    return kept if len(kept) >= 3 else words

def random_swap(words, n):
    words = words[:]
    for _ in range(n):
        if len(words) < 4: break
        i = rng.randrange(1, len(words) - 1); words[i], words[i + 1] = words[i + 1], words[i]
    return words

def span_drop(words):
    if len(words) < 60: return words
    k = int(len(words) * rng.uniform(0.05, 0.2)); i = rng.randrange(1, len(words) - k)
    return words[:i] + words[i + k:]

def rand_digits(m):
    s = m.group(0); return "".join(rng.choice("0123456789") if c.isdigit() else c for c in s)

TLDS = ["com", "net", "info", "xyz", "top", "icu", "site", "live", "online", "club", "biz", "co", "me", "link", "vip"]
def rand_domain(m):
    word = rng.choice(["secure", "verify", "promo", "get", "my", "win", "best", "deal", "claim", "go", "app", "pay", "ph", "uk", "now"])
    return word + "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(rng.randint(2, 6))) + "." + rng.choice(TLDS)

def entity_swap(t, style):
    t = re.sub(r"(?<![\w.])(\+?\d[\d -]{8,13}\d)(?![\w.])", rand_digits, t)          # phone numbers
    t = re.sub(r"(£|\$|₱|P|PHP ?|Php)(\d[\d,]*)", lambda m: m.group(1) + f"{rng.choice([1,2,3,5,7,10,15,20,25,50,100]) * rng.choice([1,10,100,1000]):,}", t)
    if style == "sms":
        t = re.sub(r"\b[a-z0-9-]{2,25}\.(com|net|info|xyz|top|icu|site|live|bid|loan|tv|life|store|pro|rest|co\.uk|biz)\b", rand_domain, t, flags=re.I)
    else:
        t = re.sub(r"(http www |www )([a-z0-9]+ )", lambda m: m.group(1) + rand_domain(None).split(".")[0] + " ", t)
    return t

def augment(text, style, label):
    words = text.split()
    ops = rng.sample(["syn", "del", "swap", "ent", "speak", "span"], k=rng.randint(2, 3))
    if label == 1 and "ent" not in ops and rng.random() < 0.6: ops.append("ent")
    if "syn" in ops: words = synonym_replace(words, rng.uniform(0.25, 0.6))
    if "del" in ops: words = random_delete(words, rng.uniform(0.04, 0.12))
    if "swap" in ops: words = random_swap(words, rng.randint(1, 2))
    if "span" in ops and style == "email": words = span_drop(words)
    t = " ".join(words) if style == "email" else rebuild_sms(text, words)
    if "ent" in ops: t = entity_swap(t, style)
    if "speak" in ops and style == "sms":
        rules = SMS_SPEAK if rng.random() < 0.6 else SMS_EXPAND
        for pat, rep in rng.sample(rules, k=min(4, len(rules))):
            t = re.sub(pat, rep, t, flags=re.I) if rng.random() < 0.7 else t
    if style == "email":
        t = to_email_style(t)
    return t

def rebuild_sms(orig, words):
    return " ".join(words) if "\n" not in orig else "\n".join(" ".join(l.split()) for l in " ".join(words).split(" \n "))

def to_email_style(t):
    """Match the Enron preprocessing: lowercase, alnum tokens only, 'subject' prefix."""
    t = t.lower().replace("'", " ")
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return t if t.startswith("subject") else "subject " + t

# ---------------------------------------------------------------- templates
def pick(x): return rng.choice(x)
FIRST = ["James","Maria","John","Anna","Mike","Sarah","David","Grace","Paul","Joy","Mark","Kim","Chris","Lisa","Tom","Rose","Ben","Ella","Sam","Nina",
         "Kevin","Jenny","Ryan","Carla","Daren","Vince","Sally","Bob","Lynn","Jeff","Kate","Ramon","Liza","Jake","Pam","Ana","Leo","Mae","Raj","Wei"]
LAST = ["Smith","Garcia","Reyes","Johnson","Santos","Lee","Brown","Cruz","Kaminski","Farmer","Taylor","Lopez","Walker","Bautista","Nguyen","Patel","Kim","Young","Hall","Allen"]
BANKS = ["BDO","BPI","Metrobank","LandBank","Chase","Wells Fargo","Barclays","HSBC","Lloyds","NatWest","Citibank","Bank of America","Security Bank","UnionBank","RCBC","PNB"]
WALLETS = ["GCash","Maya","PayPal","Venmo","Cash App","Coins.ph","Revolut"]
COURIERS = ["USPS","Royal Mail","DHL","FedEx","LBC","J&T Express","PHLPost","Evri","UPS","Ninja Van"]
AGENCIES = ["IRS","HMRC","BIR","SSS","Pag-IBIG","DVLA","LTO","PhilHealth","GSIS"]
CITIES = ["Manila","Cebu","Davao","London","Lagos","Moscow","Jakarta","Hanoi","Dubai","Toronto","Houston","Singapore","Kuala Lumpur"]
SERVICES = ["Netflix","Amazon Prime","Spotify","Disney+","McAfee","Norton","Apple iCloud","Microsoft 365","YouTube Premium"]
SHOPS = ["Shopee","Lazada","Amazon","Walmart","Tesco","SM Store","Argos","Target","Zalora"]
COINS = ["Bitcoin","USDT","Ethereum","BNB","XRP","Solana"]
SITES_GAMBLE = ["JiliWin","Lucky777","PesoBet","PanaloPlus","BingoKing","SpinMax","AcePlay","WinZone","GoldenSlot","MegaJackpot","PlayBig","RoyalSpin"]
FOODS = ["pizza","sushi","jollibee","burgers","pho","noodles","curry","bbq","dim sum","tacos"]
PLACES = ["the mall","the office","the station","home","the gym","the cafe","school","church","the library","the park","mum's","the pub"]
DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","tomorrow","tonight","this weekend","next week"]
TIMES = ["7","7:30","8","9","10","11","12","1","2","3","4","5","6","noon","half 6"]

def money(cur=None):
    cur = cur or pick(["£","$","₱","PHP ","P"])
    amt = pick([50,100,150,200,250,300,500,750,1000,1500,2000,2500,3000,5000,7500,10000,25000,50000])
    if cur in ("₱","PHP ","P"): amt *= pick([1,1,2,5,10])
    return f"{cur}{amt:,}"
def fee(): return pick(["$1.99","$2.50","$3.95","£1.45","£2.99","₱35","₱49","₱150","$4.99","£0.99"])
def phone(): return pick(["09","+639","07","+447","08","+1 ","1-800-"]) + "".join(rng.choice("0123456789") for _ in range(rng.randint(7, 9)))
def url(brand=None):
    b = (brand or pick(["secure","verify","account","claim","promo"])).lower().replace(" ", "").replace("&", "")
    form = rng.randint(0, 4)
    tail = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(rng.randint(4, 7)))
    if form == 0: return f"https://{b}-{pick(['verify','secure','help','ph','login','support'])}.{pick(TLDS)}/{tail}"
    if form == 1: return f"{pick(['bit.ly','tinyurl.com','cutt.ly','t.ly','is.gd'])}/{tail}"
    if form == 2: return f"www.{b}{rng.randint(1,99)}.{pick(TLDS)}"
    if form == 3: return f"http://{tail}.{pick(TLDS)}/{b}"
    return f"{b}.{pick(['secure-portal','account-check','claims','rewards'])}.{pick(TLDS)}"
def code(): return "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") for _ in range(rng.randint(5, 8)))
def hours(): return pick(["12","24","48","2","6"])
def name(): return pick(FIRST)
def fullname(): return f"{pick(FIRST)} {pick(LAST)}"

def maybe(s, p=0.5): return s if rng.random() < p else ""
def j(*parts): return re.sub(r"\s+", " ", " ".join(p for p in parts if p)).strip()

# ---- fraud SMS
def fraud_sms():
    k = rng.randint(0, 13)
    b, w = pick(BANKS), pick(WALLETS)
    if k == 0:
        return j(pick([f"[{b}]", f"{b} Alert:", f"{b.upper()}-ALERT:", f"Dear {b} customer,", ""]),
                 pick(["Your account has been", "Your online banking access has been", "Your card has been"]),
                 pick(["temporarily suspended", "restricted", "locked", "put on hold"]),
                 pick(["due to unusual activity.", f"after a login attempt from {pick(CITIES)}.", "due to a failed security check.", "pending re-verification."]),
                 pick([f"Verify your identity at {url(b)}", f"Restore access here: {url(b)}", f"Update your details at {url(b)}"]),
                 pick([f"within {hours()} hours to avoid permanent deactivation.", "to continue using your account.", "today.", ""]))
    if k == 1:
        return j(pick([f"{w}:", f"Good day from {w},", f"[{w}]"]), pick(["Your wallet", "Your account", "Your verified status"]),
                 pick(["will be deactivated", "is scheduled for suspension", "has been flagged"]), pick(["today", "within 24 hours", "unless verified"]) + ".",
                 pick(["Re-verify here:", "Complete KYC here:", "Confirm your OTP here:"]), url(w))
    if k == 2:
        return j(pick(["URGENT!", "Congratulations!", "WINNER!", "Dear customer,", ""]),
                 pick(["Your mobile number has been selected to receive", "You have won", "You've been awarded", "Your number won"]),
                 money(), pick(["in our anniversary draw.", f"from {pick(SHOPS)}.", "in the weekly raffle.", "cash prize."]),
                 pick([f"Call {phone()} to claim.", f"Claim at {url('claim')}.", f"Text CLAIM to {rng.randint(60000, 89999)}."]),
                 maybe(f"Claim code {code()}."), maybe(pick(["Valid 12hrs only.", "Expires today.", "T&Cs apply."])))
    if k == 3:
        c = pick(COURIERS)
        return j(f"{c}:", pick(["Your package", "Your parcel", "Your shipment"]), f"{pick(['#','No. ',''])}{code()}",
                 pick(["could not be delivered due to an incomplete address.", "is on hold at our warehouse.", "requires a customs fee."]),
                 pick([f"Pay the {fee()} redelivery fee at {url(c)}", f"Reschedule here: {url(c)}", f"Confirm your address: {url(c)}"]),
                 maybe("to avoid return to sender."))
    if k == 4:
        a = pick(AGENCIES + ["E-ZPass", "Autosweep", "Easytrip", "FasTrak"])
        return j(f"{a}:", pick(["Final notice: you have an unpaid", "Our records show an outstanding", "Reminder: overdue"]),
                 pick(["toll payment", "traffic ticket", "road violation fine", "tax balance"]), f"of {fee()}.",
                 pick([f"Pay by {pick(DAYS)} at {url(a)}", f"Settle now at {url(a)}"]),
                 pick(["to avoid a penalty and legal action.", "to avoid late fees and suspension of your license.", ""]))
    if k == 5:
        return j(pick(["Hi,", "Hello sir/mam,", f"Hi {name()},", "Good day!"]),
                 pick(["we found your profile online.", "you have been selected for a part-time job.", "our company is hiring online staff."]),
                 pick([f"Daily salary {money('₱')}-{money('₱')}.", f"Earn {money('$')} per day.", f"Earn {money('£')} a day working from home."]),
                 pick(["Only 1-2 hrs a day.", "Just like and review products.", "No experience needed."]),
                 pick([f"Contact WhatsApp {phone()}", f"Telegram: @{pick(['hr','job','work'])}{rng.randint(100,999)}", f"Apply: {url('job')}"]))
    if k == 6:
        return j(pick(["Earn", "Get", "Enjoy"]), f"{rng.randint(10, 60)}% {pick(['weekly', 'daily', 'monthly'])}",
                 pick(["guaranteed returns", "guaranteed profit"]), f"with our {pick(COINS)} trading program.",
                 f"Start with only {money()}.", pick([f"Join: {url('invest')}", f"Message our mentor {phone()}"]))
    if k == 7:
        return j(pick(["Hi mum,", "Hi dad,", "Hey it's me,", "Ma,"]), pick(["I dropped my phone, this is my new number.", "my phone broke, using a friend's.", "new number, save this."]),
                 pick(["Can you send", "I need you to transfer", "Please send"]), money(), pick(["for rent", "for an urgent bill", "to my friend's account", "for the hospital"]),
                 pick(["I'll pay you back tomorrow.", "Can't talk now, just text.", "Will explain later x"]))
    if k == 8:
        a = pick(AGENCIES)
        return j(f"{a}:", pick(["You are eligible for a tax refund of", "You can receive a benefit of", "Unclaimed refund of"]), money() + ".",
                 pick([f"Submit your claim at {url(a)}", f"Verify your records: {url(a)}"]), maybe("before the deadline."))
    if k == 9:
        sv = pick(SERVICES)
        return j(f"{sv}:", pick([f"Your subscription will automatically renew for {fee()} today.", f"We were unable to process your payment of {fee()}.",
                                 f"A charge of {fee()} has been made."]), pick([f"To cancel, visit {url(sv)}", f"Update billing: {url(sv)}", f"Not you? Call {phone()}"]))
    if k == 10:
        return j(pick([f"{b}:", f"{w}:"]), pick(["Someone tried to log in to your account.", "A new device was linked to your account.", "Your registered number needs updating."]),
                 pick(["If this wasn't you,", "To secure your account,", "To keep receiving OTPs,"]), pick([f"confirm here {url(b)}", f"update here {url(b)}", f"call {phone()}"]))
    if k == 11:
        return j("Dear customer, your", f"{rng.randint(1, 99):,},{rng.randint(100, 999)}", pick(["reward points", "points"]), "will expire",
                 pick(["tonight.", "tomorrow.", "today."]), f"Redeem for {money('₱')} cash at {url(b)}")
    if k == 12:
        return j(pick([f"Ang iyong {w} account ay pansamantalang na-lock.", f"Babala mula sa {b}: may kahina-hinalang login sa iyong account.",
                       f"Ikaw ay nanalo ng {money('₱')} mula sa {pick(SHOPS)}!"]),
                 pick([f"I-verify sa {url(w)}", f"I-claim dito: {url('claim')}", f"Mag-update dito {url(b)}"]), pick(["sa loob ng 24 oras.", "ngayon din.", ""]))
    return j(pick(["Hello,", "Hi,", ""]), pick(["Is this", "Are you"]), f"{name()}?",
             pick(["I got your number from a friend.", "Sorry wrong number, but nice to meet you.", "We met at the event last week."]),
             pick([f"I make good money trading {pick(COINS)}, want me to teach you?", "I can show you an investment that earns daily profit.",
                   f"My uncle runs a platform with guaranteed returns: {url('trade')}"]))

# ---- fraud email (rendered in Enron style)
def fraud_email():
    k = rng.randint(0, 5)
    if k == 0:
        return j(pick(["urgent business proposal", "confidential", "request for assistance", "from the desk of", "dear friend"]),
                 f"dear friend i am {pick(['barrister', 'dr', 'mr', 'mrs'])} {fullname()}", pick(["a bank manager", "the personal attorney", "an auditor"]),
                 f"at {pick(['union bank', 'standard trust bank', 'central bank'])} in {pick(CITIES)}.",
                 f"i discovered an abandoned sum of {rng.randint(5, 45)} million us dollars belonging to a deceased client who died without a next of kin.",
                 pick(["i seek your consent to present you as the beneficiary", "i need a foreign partner to receive the funds"]),
                 f"and you will receive {rng.randint(20, 40)} percent of the total sum.",
                 pick(["this transaction is 100 risk free", "please treat this as strictly confidential"]),
                 f"reply with your full name bank details and phone number to {pick(['private', 'confidential', 'secure'])}{rng.randint(1, 99)} {pick(['yahoo', 'hotmail', 'gmail'])} com")
    if k == 1:
        return j(pick(["winning notification", "congratulations you have won", "final notice lottery award", "your email has won"]),
                 f"we are pleased to inform you that your email address won {money('$')} in the {pick(['international', 'euro', 'online', 'microsoft'])} lottery",
                 f"draw held on {pick(DAYS)}. your ticket number is {code()} and reference {code()}.",
                 f"to claim your prize contact our claims agent {fullname()}", f"with your name address and a processing fee of {fee()}.",
                 "keep this award confidential to avoid double claiming.")
    if k == 2:
        b = pick(BANKS + ["paypal", "ebay", "amazon"])
        return j(pick(["account security notice", "update your account information", "important notice", "verify your account"]),
                 f"dear {b} customer during our regular verification of accounts we could not verify your information.",
                 pick(["your account access has been limited", "your account will be suspended", "we have placed a hold on your account"]),
                 f"please click the link below to confirm your identity http {url(b).replace('https://', '').replace('.', ' ').replace('/', ' ')}",
                 pick(["if you do not update within 48 hours your account will be closed", "failure to comply will result in suspension"]),
                 f"thank you {b} security department")
    if k == 3:
        sym = "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(4))
        return j(pick(["investor alert", "hot stock pick", "this stock is about to explode", "breaking news"]),
                 f"symbol {sym} current price 0 {rng.randint(10, 95)} target price {rng.randint(1, 5)} 00",
                 pick(["this company just signed a major contract", "huge news release expected this week", "insiders are buying"]),
                 pick(["get in before the big move", "this is a strong buy", "watch it climb on monday"]),
                 f"{sym} could return {rng.randint(200, 900)} percent", "this is not investment advice the publisher was compensated")
    if k == 4:
        return j(pick(["job offer", "position available", "work at home opportunity", "financial manager vacancy"]),
                 f"our company {pick(['global payments ltd', 'easy transfer inc', 'eurotrade group'])} is looking for a regional representative",
                 "your job is to receive payments from our customers into your bank account and forward them via western union",
                 f"you keep {rng.randint(5, 15)} percent of each transfer", f"earn {money('$')} per week working from home only a few hours a day",
                 "reply with your full name phone and bank details to get started")
    return j(pick(["your package delivery", "invoice attached", "tax refund notification"]),
             pick([f"we were unable to deliver your parcel tracking {code()}", f"you are eligible to receive a tax refund of {money('$')}"]),
             pick(["please complete the attached form", "login to the secure portal below"]), f"http {pick(['secure', 'refund', 'track'])} {code().lower()} com",
             "and confirm your card details to process your request")

# ---- solicitation SMS
def solicit_sms():
    k = rng.randint(0, 10)
    if k == 0:
        s = pick(SITES_GAMBLE)
        return j(pick([f"[{s}]", f"{s}:", "", f"<REAL NAME>, "]), pick(["Get", "Claim", "Enjoy", "Grab"]), f"{pick([50,100,150,200,300])}%",
                 pick(["welcome bonus", "deposit bonus", "first deposit bonus"]), f"up to {money('₱')}!",
                 pick(["Play slots & fishing games.", "Daily cashback up to 7%.", "Win big tonight!", "Free spins daily."]),
                 pick([f"Register now: {s.lower()}{rng.randint(1,99)}.{pick(['com','tv','vip','icu','ph'])}", f"Sign up: {url(s)}"]))
    if k == 1:
        s = pick(SITES_GAMBLE)
        return j(pick([f"Magdeposito ng {money('₱')} sa {s} at makakuha ng 100% bonus!", f"Libreng {money('₱')} sa bagong miyembro ng {s}!",
                       f"Sumali sa {s} at manalo araw-araw!"]), pick(["Mag-register na:", "Laro na:", "I-claim dito:"]), f"{s.lower()}.{pick(['tv','vip','bid','xyz'])}")
    if k == 2:
        return j(pick(["FreeMsg:", "Free entry", "Ringtone Club:", ""]), pick(["Get the latest", "Your weekly", "Download"]),
                 pick(["ringtones & wallpapers", "chart hits", "video clips", "polyphonic tones"]), pick(["sent direct to ur mob!", "every week!", "for your phone!"]),
                 f"Txt {pick(['TONE', 'GO', 'MUSIC', 'JOIN', 'POLY'])} to {rng.randint(80000, 89999)}.", f"{fee()}/wk.", maybe("16+ only."), "Txt STOP to end")
    if k == 3:
        return j(pick(["Lonely?", "Single?", "Bored tonight?", "Hey sexy,"]), pick(["Find a partner in your area!", "Hot local singles want to chat!", "1000s of real people waiting!"]),
                 pick([f"Txt CHAT to {rng.randint(60000, 89999)}", f"Call {phone()}", f"Reply DATE to {rng.randint(60000, 89999)}"]), f"{fee()}/msg", maybe("18+"))
    if k == 4:
        sh = pick(SHOPS)
        return j(f"{sh}:", pick(["MEGA SALE!", "Payday sale is LIVE!", "Flash deals today!", "11.11 Sale!"]), f"Up to {rng.randint(30, 90)}% off",
                 pick(["on gadgets", "storewide", "on fashion", "on appliances"]), pick(["+ free shipping.", "+ vouchers.", ""]),
                 pick(["Shop now in the app.", f"Shop: {url(sh)}"]), maybe("Reply STOP to opt out."))
    if k == 5:
        return j(pick(["PRE-SELLING", "RESALE", "New", "RFO"]), pick(["condo units", "office space", "commercial lots", "house and lot"]),
                 f"in {pick(['Makati', 'BGC', 'Ortigas', 'Cavite', 'Pasig', 'QC', 'Cebu IT Park'])}!", pick(["Low downpayment.", "0% interest.", "As low as " + money('₱') + "/month."]),
                 pick(["For inquiries text", "Call/Viber"]), phone(), maybe("Thank you."))
    if k == 6:
        return j(pick(["Need cash?", "Fast loan approval!", "Loan up to " + money('₱') + "!"]), pick(["No collateral, low interest.", "Approval in 5 minutes.", "Minimal requirements."]),
                 pick([f"Apply at {url('loan')}", f"Download the app: {url('cash')}", f"Text {phone()}"]))
    if k == 7:
        return j(pick(["Great NEW Offer -", "Upgrade now!", "Exclusive:"]), pick(["DOUBLE mins & DOUBLE txt", "unlimited data", "a FREE camera phone"]),
                 pick(["on our best tariffs!", "for just " + fee() + "/day!", "when you renew!"]), f"Call {phone()}", maybe("T&Cs apply."))
    if k == 8:
        return j(pick(["Lose 10kg in 30 days!", "Doctors hate this trick!", "Natural slimming tea!"]), pick(["100% natural.", "No diet needed.", "As seen on TV."]),
                 f"Order now: {url('slim')}", maybe(f"COD available. Call {phone()}"))
    if k == 9:
        return j(pick(["Make money while watching videos!", "Earn while you play!"]), f"Get {money('₱')} bonus on sign up.",
                 f"Download: {url('earn')}")
    return j(pick(["You're invited!", "Join us"]), pick(["tonight", "this Friday", "this weekend"]), "at", pick(["Sky Bar", "The Lounge", "Club 88", "Rooftop 21"]),
             pick(["for ladies night.", "for 2-for-1 cocktails.", "live DJ and free entry before 10pm."]), f"Reserve: {phone()}")

# ---- solicitation email
PILLS = ["viagra", "cialis", "levitra", "xanax", "valium", "vicodin", "soma", "ambien", "phentermine", "meridia"]
SOFT = ["windows xp professional", "office 2003", "adobe photoshop cs", "macromedia studio", "norton antivirus", "autocad 2005", "corel draw"]
def solicit_email():
    k = rng.randint(0, 7)
    if k == 0:
        return j(pick(["cheap meds online", "save on prescriptions", "your pharmacy order", "best prices on meds"]),
                 f"get {pick(PILLS)} {pick(PILLS)} and {pick(PILLS)} at up to {rng.randint(50, 85)} percent off",
                 pick(["no prescription needed", "fda approved", "discreet shipping worldwide"]), pick(["overnight delivery", "lowest prices online", "satisfaction guaranteed"]),
                 f"order now http www {rand_domain(None).split('.')[0]} com", maybe("to be removed from our list click here"))
    if k == 1:
        return j(pick(["oem software", "cheap software", "software at low prices"]), "we offer", ", ".join(rng.sample(SOFT, 3)),
                 f"at {money('$')} only", pick(["download instantly", "100 genuine", "save up to 90"]), f"visit http www {rand_domain(None).split('.')[0]} com")
    if k == 2:
        return j(pick(["replica watches", "luxury for less", "rolex replicas"]), f"high quality replicas of {pick(['rolex', 'omega', 'cartier', 'breitling'])} watches",
                 "at a fraction of the price", pick(["free shipping", "lifetime warranty"]), f"shop now http {rand_domain(None).split('.')[0]} com")
    if k == 3:
        return j(pick(["refinance today", "mortgage rates at record lows", "home loan approval"]), f"rates as low as {rng.randint(2, 4)} {rng.randint(10, 99)}",
                 "save thousands of dollars on your monthly payments", pick(["bad credit ok", "no obligation quote"]),
                 f"apply now it only takes 2 minutes http www {rand_domain(None).split('.')[0]} com")
    if k == 4:
        return j(pick(["get your degree", "university diploma", "obtain a prosperous future"]), pick(["bachelors masters mba and doctorate", "no exams no classes"]),
                 "based on your life experience", f"call {phone()} 24 hours a day 7 days a week")
    if k == 5:
        return j(pick(["increase your web traffic", "seo services", "email marketing that works", "promote your business"]),
                 f"we will send your ad to {rng.randint(1, 50)} million targeted email addresses", pick(["guaranteed top 10 ranking on google", "for only " + money('$')]),
                 "reply for a free consultation", maybe("to unsubscribe reply with remove"))
    if k == 6:
        return j(pick(["lose weight fast", "new weight loss breakthrough", "burn fat while you sleep"]), f"lose up to {rng.randint(10, 30)} pounds in {rng.randint(2, 6)} weeks",
                 pick(["all natural", "clinically proven", "no diet no exercise"]), f"order today http www {rand_domain(None).split('.')[0]} com")
    return j(pick(["special offer for you", "limited time offer", "exclusive deal"]), pick(["printer ink cartridges", "digital cameras", "vacation packages", "cigarettes online"]),
             f"up to {rng.randint(40, 80)} percent off", "click here to see our catalog", f"http www {rand_domain(None).split('.')[0]} com")

# ---- ham SMS
def ham_sms():
    k = rng.randint(0, 11)
    n, pl, d, tm = name(), pick(PLACES), pick(DAYS), pick(TIMES)
    opts = {
     0: [f"Hey, are we still on for {d}?", f"Still meeting at {pl} {d}?", f"What time {d}? {tm} ok?"],
     1: [f"I'm at {pl} now, where are you?", f"Running late, be there in {rng.randint(5, 30)} mins", f"Just left {pl}, see you soon"],
     2: [f"Can you pick up some milk on the way home?", f"Don't forget to grab bread and eggs", f"Can you get {pick(FOODS)} for dinner?"],
     3: [f"Happy birthday {n}! Have a great day", f"Congrats on the new job {n}!", f"Hope you feel better soon {n}"],
     4: [f"Call me when you're free", f"Can't talk now, in a meeting. Will call later", f"Sorry missed your call, what's up?"],
     5: [f"Did you finish the assignment?", f"What did the teacher say about the test?", f"Are you coming to class {d}?"],
     6: [f"Mum says dinner at {tm}", f"Dad's picking you up at {tm}", f"Grandma's coming over {d}"],
     7: [f"Want to get {pick(FOODS)} {d}?", f"Movie {d}? There's a {tm} showing", f"Fancy a drink after work?"],
     8: [f"Ok see you then", f"Sounds good :)", f"Haha that's so funny", f"Yeah I know right", f"Lol no way", f"K thanks"],
     9: [f"Reached home safely", f"Got your message, thanks", f"Just woke up, will reply properly later"],
     10: [f"Is {n} coming too?", f"Tell {n} I said hi", f"Have you heard from {n}?"],
     11: [f"I'll transfer the money for the tickets tonight", f"How much do I owe you for {d}?", f"Paid you back for the {pick(FOODS)}, check your account"],
    }
    t = pick(opts[k])
    if rng.random() < 0.4: t = j(t, pick(["", "x", ":)", "lol", "thanks!", "ok?", "pls reply", "love you"]))
    if rng.random() < 0.35:
        for pat, rep in rng.sample(SMS_SPEAK, 4): t = re.sub(pat, rep, t, flags=re.I)
    return t

# ---- ham email (business, Enron style)
TOPICS = ["the q3 budget", "the gas nominations", "the meter reconciliation", "the trading agreement", "the risk report", "the hpl contract",
          "the project timeline", "the conference call", "the vendor invoice", "the model results", "the curve update", "the offsite agenda"]
def ham_email():
    n1, n2, top, d = name().lower(), name().lower(), pick(TOPICS), pick(DAYS).lower()
    subject = pick([f"re {top.replace('the ', '')}", f"fw {top.replace('the ', '')}", top.replace("the ", ""), f"meeting {d}", "follow up", "quick question", "updated numbers"])
    body = rng.sample([
        f"{n2} can you take a look at {top} before {d}",
        f"i have attached the latest version of {top} for your review",
        f"please let me know if you have any questions",
        f"we need to discuss {top} at the {pick(['weekly', 'monthly', 'staff'])} meeting",
        f"the volumes for meter {rng.randint(1000, 9999)} were changed to {rng.randint(1, 90)} 000 mmbtu per day",
        f"i spoke with {pick(FIRST).lower()} and they agreed to move the deadline to {d}",
        f"can we set up a call {d} at {pick(TIMES)} to go over the details",
        f"the deal ticket {rng.randint(100000, 999999)} has been updated in sitara",
        f"thanks for your help on this",
        f"please forward this to anyone on your team who needs it",
        f"i will be out of the office {d} so please contact {pick(FIRST).lower()} in the meantime",
        f"the presentation went well and the group had a lot of good questions",
        f"we are still waiting on legal to approve the final language",
        f"let s plan to finalize everything by end of {pick(['week', 'month', 'day'])}",
        f"see the numbers below and let me know if anything looks off",
    ], k=rng.randint(2, 6))
    return j("subject", subject, n2 if rng.random() < 0.5 else "", " ".join(body), pick(["thanks", "regards", "best", ""]), n1)

GEN = {("fraud", "sms"): fraud_sms, ("fraud", "email"): fraud_email, ("solicitation", "sms"): solicit_sms,
       ("solicitation", "email"): solicit_email, ("ham", "sms"): ham_sms, ("ham", "email"): ham_email}

# ---------------------------------------------------------------- synthesis
targets = {"ham": TARGET_PER_CLASS, "fraud": FRAUD_TARGET, "solicitation": TARGET_PER_CLASS - FRAUD_TARGET}
real_counts = real.spam_type.value_counts().to_dict()
if real_counts.get("fraud", 0) > FRAUD_TARGET:  # never drop real rows
    targets["fraud"] = real_counts["fraud"]; targets["solicitation"] = TARGET_PER_CLASS - targets["fraud"]
syn_rows = []

def add_syn(text, st, style, method, parent):
    k = norm_key(text)
    if len(k) < 3 or k in seen: return False
    seen.add(k)
    syn_rows.append({"message": text, "label": 0 if st == "ham" else 1, "spam_type": st, "source": "synthetic", "style": style,
                     "is_synthetic": True, "gen_method": method, "parent_id": parent, "split": "train", "key": k})
    return True

for st, tgt in targets.items():
    need = tgt - real_counts.get(st, 0)
    pool = real[(real.spam_type == st) & (real.split == "train")]
    # ~80% of the gap from augmenting real rows (capped per parent), the rest from templates
    n_aug = min(int(need * 0.8), len(pool) * MAX_AUG_PER_PARENT)
    made, guard = 0, 0
    order = pool.sample(frac=1, random_state=SEED)
    while made < n_aug and guard < n_aug * 5:
        for _, r in order.iterrows():
            if made >= n_aug: break
            guard += 1
            if add_syn(augment(r.message, r["style"], r.label), st, r["style"], "augment", r.id): made += 1
    # template fill, style mix mirrors the real class
    style_p = real[real.spam_type == st]["style"].value_counts(normalize=True)
    style_p = (style_p * 0.5 + 0.25).reindex(["sms", "email"]).fillna(0.25)   # pull toward 50/50 so SMS isn't starved
    style_p = style_p / style_p.sum()
    tmpl_need, guard = need - made, 0
    while tmpl_need > 0 and guard < 2_000_000:
        guard += 1
        style = "sms" if rng.random() < style_p["sms"] else "email"
        txt = GEN[(st, style)]()
        if style == "email": txt = to_email_style(txt)
        if add_syn(txt, st, style, "template", ""): tmpl_need -= 1
    print(f"{st:13s} real={real_counts.get(st,0):6d}  augmented={made:6d}  template={need-made-tmpl_need:6d}  short={tmpl_need}")

syn = pd.DataFrame(syn_rows)
syn["id"] = ["s" + hashlib.md5(k.encode()).hexdigest()[:12] for k in syn.key]
full = pd.concat([real, syn], ignore_index=True).sample(frac=1, random_state=SEED).reset_index(drop=True)
cols = ["id", "message", "label", "spam_type", "source", "style", "is_synthetic", "gen_method", "parent_id", "split"]
full = full[cols]
full[["message", "label", "spam_type"]].to_csv(os.path.join(out_dir, "spam_ham_100k.csv"), index=False)
full.to_csv(os.path.join(out_dir, "spam_ham_100k_full.csv"), index=False)

# ---------------------------------------------------------------- report
print("\nraw rows:", n_raw, " cleaned real rows kept:", len(real))
for k, v in stats.items(): print(f"  removed {v:6d}  {k}")
print("\ntotal:", len(full)); print(full.label.value_counts().to_string()); print(full.spam_type.value_counts().to_string())
print(pd.crosstab([full.split], [full.is_synthetic]).to_string())
assert full.message.map(norm_key).is_unique
assert not full[(full.split != "train") & full.is_synthetic].shape[0]
assert set(full[full.gen_method == "augment"].parent_id) <= set(real[real.split == "train"].id)
print("checks passed: unique, no synthetic in val/test, augment parents only from train")
