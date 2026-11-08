#!/usr/bin/env python3
"""Build synthetic scam texts for four under-covered scam types (Tuan, 2026-11-08).

    government_threat  label 1  "SSA: your number is suspended, a warrant will be issued, call now"
    irs                label 1  "IRS final notice: you owe $3,412 in back taxes, pay today or be arrested"
    id_request         label 1  "send a photo of your driver's license and SSN to verify your account"
    health             label 5  "your Medicare card is expiring", miracle cures, free test kits, cheap pills

150 rows each, 600 in all, every one a scam (is_spam 1). Government, IRS and ID requests are
imposters or phishing, so they get label 1 (Imposter & Phishing); health scams get label 5
(Health & Pharmacy). See data/scam_categories.csv.

Phone numbers use the reserved 555-01xx range and the links are made-up lookalike domains, so no
row points at a real number or site.

Stdlib only, no network, fixed seed: two runs give byte-identical files.

    python3 -I data/build_gov_health_id_scam_synthetic.py            # writes next to this script
    python3 -I data/build_gov_health_id_scam_synthetic.py <out_dir>

Output (same columns as potential_threat_synthetic.csv):
  gov_health_id_scam_synthetic.csv  600 rows, split=train, is_synthetic=True

classifier/build_splits.py reads this file with the threat templates: 15% of each scenario goes to
val, the rest to train.
"""

from __future__ import annotations

import csv
import hashlib
import random
import re
import sys
from pathlib import Path

SEED = 20261110
SOURCE = "synthetic_gov_health_id"
PER_SCENARIO = 150

COLUMNS = ["id", "message", "label_class", "category_name", "ftc_subcategory", "label_method",
           "label_confidence", "is_spam", "source", "style", "is_synthetic", "gen_method",
           "parent_id", "split", "scenario"]

# scenario -> (label_class, category_name, ftc_subcategory). FTC 7 = Imposter Scams,
# 27 = Privacy, Data Security and Cyber Threats, 6 = Health Care.
LABELS = {
    "government_threat": (1, "Imposter & Phishing", 7),
    "irs": (1, "Imposter & Phishing", 7),
    "id_request": (1, "Imposter & Phishing", 27),
    "health": (5, "Health & Pharmacy", 6),
}

# ---------------------------------------------------------------- slot values

NAMES = ["John", "Mary", "James", "Linda", "Robert", "Patricia", "Michael", "Barbara", "David",
         "Susan", "Richard", "Karen", "Joseph", "Nancy", "Thomas", "Betty", "Charles", "Helen"]
OFFICERS = ["Officer Daniel Brooks", "Agent Mark Wilson", "Sgt. Ray Collins", "Agent Lisa Grant",
            "Officer James Carter", "Deputy Paul Reed", "Agent Steve Harper", "Lt. Kevin Moore"]
AGENCIES = ["Social Security Administration", "SSA", "US Marshals Service", "Department of Justice",
            "FBI", "Homeland Security", "US Immigration (USCIS)", "ICE", "County Sheriff's Office",
            "State Police", "Federal Court", "DMV", "Department of Motor Vehicles", "US Customs",
            "Federal Trade Commission", "Treasury Department", "US Postal Inspection Service"]
GOV_PROBLEMS = [
    "your Social Security number has been suspended due to suspicious activity",
    "your SSN was used in a drug trafficking case in Texas",
    "a warrant has been issued for your arrest",
    "you missed federal jury duty and a bench warrant is pending",
    "your driver's license will be suspended for unpaid tolls",
    "your immigration status is under review and you face deportation",
    "a package in your name was seized with illegal items",
    "your benefits will be terminated today",
    "a lawsuit has been filed against you",
    "your vehicle registration has been flagged for fraud",
    "your bank accounts will be frozen by court order",
    "there is a criminal complaint registered under your name",
    "your passport has been flagged and will be revoked",
    "you have an unpaid traffic citation with a court date today",
]
GOV_THREATS = [
    "Local police will come to your home within 24 hours",
    "You will be arrested if you do not respond",
    "Failure to comply will result in immediate arrest",
    "Officers have been dispatched to your address",
    "Your assets will be seized",
    "This is your final notice before legal action",
    "Ignoring this will lead to jail time and fines",
    "Do not tell anyone about this case, it is confidential",
    "Do not hang up or contact your bank, this is a federal matter",
    "Your license and benefits will be cancelled permanently",
]
IRS_PROBLEMS = [
    "you owe {amount} in unpaid back taxes",
    "your 2025 tax return has a discrepancy of {amount}",
    "a tax lien of {amount} has been placed on your property",
    "you are eligible for a tax refund of {amount} but must verify your identity",
    "your tax refund of {amount} is on hold",
    "your wages will be garnished for {amount} owed",
    "an audit found {amount} in unreported income",
    "your stimulus payment of {amount} is ready to claim",
    "a criminal tax case has been opened against you for {amount}",
    "your EIN/SSN is linked to tax fraud of {amount}",
]
IRS_SENDERS = ["IRS", "Internal Revenue Service", "IRS Tax Division", "IRS Collections",
               "IRS Criminal Investigation", "US Treasury - IRS", "IRS Refund Dept", "Tax Enforcement"]
IRS_ACTIONS = [
    "pay today with gift cards to avoid arrest",
    "pay now to stop legal action",
    "verify your SSN and bank details at {link}",
    "claim your refund at {link} within 24 hrs",
    "call {phone} immediately or a warrant will be issued",
    "settle with Apple or Google Play gift cards and send the codes",
    "pay with Bitcoin at the nearest ATM to close the case",
    "confirm your identity at {link} to release the funds",
    "wire the balance today, our agent will call you",
    "reply with your full name, DOB and SSN to process",
]
PAY = ["Apple gift cards", "Google Play cards", "Target gift cards", "Bitcoin", "a Bitcoin ATM",
       "Zelle", "Cash App", "a wire transfer", "Western Union", "MoneyGram", "Steam cards"]
ID_DOCS = ["a photo of your driver's license", "a clear photo of your ID (front and back)",
           "your Social Security number", "a selfie holding your ID", "a scan of your passport",
           "your SSN and date of birth", "your state ID and a utility bill",
           "your license number and SSN", "a picture of your Social Security card",
           "your passport photo page", "a copy of your ID and your mother's maiden name",
           "your full SSN and bank login"]
# Sender -> reasons that fit it, so a bank doesn't ask for ID "before we meet".
ID_PAIRS = {
    ("Bank Security Team", "Chase Alert", "Wells Fargo Fraud Dept", "Zelle Support", "PayPal"): [
        "to verify your account or it will be locked", "to restore access to your bank account",
        "to stop the fraudulent charge on your card", "to reverse the $1,200 transfer"],
    ("HR Department", "Hiring Manager", "Recruiter"): [
        "to complete your onboarding for the remote job", "for your background check, start Monday",
        "so we can set up direct deposit for your first paycheck"],
    ("USPS Customs", "FedEx Delivery", "UPS Customs Desk"): [
        "to release your package held at customs", "to confirm the delivery address on your package"],
    ("Unemployment Office", "Benefits Office", "Medicare Services"): [
        "to confirm your identity for your unemployment claim", "to update your benefits records",
        "to confirm your Medicare enrollment"],
    ("Coinbase Support", "Binance Verification", "Crypto Wallet Team"): [
        "to unlock your crypto withdrawal", "to complete KYC verification"],
    ("Leasing Office", "Property Manager"): ["so we can process your rental application",
                                            "to hold the apartment before someone else takes it"],
    ("T-Mobile Security", "Verizon Account Team", "Amazon Account Team", "Account Services", "Verification Team"): [
        "to keep your phone number from being disconnected", "to verify your age for your account",
        "to verify your account or it will be locked"],
    ("Prize Claims Dept", "Sweepstakes Center"): ["to receive your prize payout", "to release your $5,000 winnings"],
    ("Loan Approval Team", "Lending Desk"): ["to finish your loan approval today"],
}
HEALTH_HOOKS = [
    "your Medicare card is expiring, get your new card at {link}",
    "you qualify for a FREE back brace covered by Medicare, reply YES",
    "Medicare is issuing new chip cards, confirm your Medicare number to avoid losing coverage",
    "your health insurance will be cancelled today, renew at {link}",
    "you qualify for a $0 health plan plus a $6,400 subsidy card, call {phone}",
    "claim your free COVID and flu test kits at {link}, just pay shipping",
    "doctors hate this: 1 pill melts 30 lbs in 30 days, order at {link}",
    "this miracle supplement reverses diabetes in 2 weeks, 80% off today",
    "cure arthritis pain overnight with our breakthrough formula, {link}",
    "your lab results are ready, log in with your insurance ID at {link}",
    "buy Ozempic without a prescription, 70% off, ships today",
    "cheap Viagra, Xanax and Oxycodone, no prescription needed, {link}",
    "your prescription refill is on hold, confirm your card at {link}",
    "free genetic cancer screening covered 100% by Medicare, send your Medicare ID",
    "CBD gummies that cure anxiety and cancer, final day of free bottle offer",
    "your pharmacy account needs verification, enter your DOB and SSN at {link}",
    "Medicare benefits update: you are owed a ${refund} refund, call {phone}",
    "lose belly fat with keto drops, only pay shipping, {link}",
    "the hospital billed you twice, get your ${refund} refund at {link}",
    "FDA approved hearing aids FREE for seniors this week only, call {phone}",
    "your Obamacare plan expires tonight, re-enroll at {link} or lose coverage",
    "secret herbal cure for high blood pressure, doctors don't want you to know, {link}",
    "your dental plan was upgraded for free, confirm with your SSN at {link}",
    "free diabetic supplies shipped today, verify your Medicare number by reply",
]
DOMAINS = {
    "government_threat": ["ssa-gov-verify.com", "ssn-suspension-center.com", "court-notice-us.com",
                          "dmv-renewal-online.net", "uscis-status-check.co", "gov-benefits-update.com",
                          "warrant-lookup-us.info", "federal-case-portal.net"],
    "irs": ["irs-refund-claim.net", "irs-gov.help", "usa-taxrefund.info", "tax-lien-pay.net",
            "irs-taxpay-online.com", "treasury-refund.us"],
    "id_request": ["id-verify-secure.com", "account-verify-now.net", "secure-verify-portal.info",
                   "verify-identity-center.co", "kyc-upload-center.com", "docs-verify.net"],
    "health": ["medicare-card-update.com", "medicare-benefits.us", "healthplan-renew.info",
               "rx-discount-direct.net", "free-testkits-usa.com", "slim-keto-now.com",
               "miracle-cure-labs.info", "senior-health-benefits.co"],
}
OPENERS = ["", "", "", "URGENT: ", "FINAL NOTICE: ", "ALERT: ", "Attention {name}: ", "Dear {name}, ",
           "Hello {name}, ", "IMPORTANT: ", "Notice: ", "[Action Required] ", "Re: case #{case} - "]
CLOSERS = ["", "", "", " Reply STOP to opt out", " Do not ignore.", " Act now.", " Thank you.",
           " Case #{case}.", " Ref: {case}", " Call back at {phone}.", " Respond within 24 hours.",
           " This is your last warning."]


def amount(r: random.Random) -> str:
    n = r.choice([r.randrange(400, 999), r.randrange(1000, 9999), r.randrange(10000, 48000)])
    return r.choice([f"${n:,}", f"${n:,}.{r.randrange(10, 99)}", f"${n}", f"{n:,} dollars"])


def phone(r: random.Random) -> str:
    area = r.choice(["800", "888", "877", "866", "202", "213", "305", "512", "646", "713"])
    tail = f"01{r.randrange(0, 100):02d}"
    return r.choice([f"{area}-555-{tail}", f"({area}) 555-{tail}", f"1-{area}-555-{tail}", f"{area}.555.{tail}"])


def link(r: random.Random, scenario: str) -> str:
    d = r.choice(DOMAINS[scenario])
    path = r.choice(["", "/verify", "/claim", "/case", "/login", "/pay", "/update", f"/{r.randrange(1000, 99999)}"])
    return r.choice(["https://", "http://", "", "www."]) + d + path


def slots(r: random.Random, scenario: str) -> dict:
    return {"name": r.choice(NAMES), "officer": r.choice(OFFICERS), "agency": r.choice(AGENCIES),
            "amount": amount(r), "phone": phone(r), "link": link(r, scenario), "pay": r.choice(PAY),
            "case": f"{r.choice('ABCDEFKLMRSTX')}{r.randrange(10000, 999999)}",
            "refund": f"{r.randrange(90, 2400):,}", "hours": r.choice(["24", "48", "12", "2", "6"])}


def government_threat(r: random.Random) -> str:
    s = slots(r, "government_threat")
    t = r.choice([
        "{agency}: {problem}. {threat}. Call {phone} now.",
        "This is {officer} with {agency}. {problem_cap}. {threat}. Call me back at {phone}.",
        "{agency} NOTICE: {problem}. To avoid arrest pay the fine of {amount} with {pay} today.",
        "{problem_cap}. {threat}. Press 1 or call {phone} to speak with {officer}.",
        "{agency}: {problem}. Verify your identity at {link} within {hours} hours. {threat}.",
        "Message from {agency}: {problem}. A fine of {amount} must be paid in {pay} to clear your record.",
        "{officer}, {agency}. {problem_cap}. You must pay a {amount} bond with {pay}. {threat}.",
        "Your case has been escalated. {problem_cap}. {threat}. Resolve it at {link}",
    ])
    problem = r.choice(GOV_PROBLEMS)
    return t.format(problem=problem, problem_cap=problem[:1].upper() + problem[1:],
                    threat=r.choice(GOV_THREATS), **s)


def irs(r: random.Random) -> str:
    s = slots(r, "irs")
    problem = r.choice(IRS_PROBLEMS).format(**s)
    action = r.choice(IRS_ACTIONS).format(**s)
    t = r.choice([
        "{sender}: {problem}. {action_cap}.",
        "{sender} FINAL NOTICE - {problem}. {action_cap}.",
        "This is {officer}, {sender}. {problem_cap}. {action_cap}.",
        "{problem_cap}. {action_cap}. - {sender}",
        "{sender}: our records show {problem}. If you do not {action} you will be arrested.",
        "Tax notice: {problem}. {action_cap}. Call {phone} with questions. {sender}",
    ])
    return t.format(sender=r.choice(IRS_SENDERS), problem=problem, problem_cap=problem[:1].upper() + problem[1:],
                    action=action, action_cap=action[:1].upper() + action[1:], **s)


def id_request(r: random.Random) -> str:
    s = slots(r, "id_request")
    t = r.choice([
        "{sender}: please send {doc} {reason}.",
        "{sender}: reply with {doc} {reason}.",
        "Hi {name}, we need {doc} {reason}. Upload it at {link}",
        "{sender}: action required. Text back {doc} {reason} within {hours} hours.",
        "Hello, this is {sender}. We need {doc} {reason}. Send it to this number.",
        "{sender}: your account is restricted. Upload {doc} at {link} {reason}.",
        "{sender}: we could not verify you. Reply with {doc} {reason} or call {phone}.",
        "hey its {name} from {sender}, can you just send me {doc} {reason}? thx",
    ])
    senders, reasons = r.choice(list(ID_PAIRS.items()))
    return t.format(sender=r.choice(senders), doc=r.choice(ID_DOCS), reason=r.choice(reasons), **s)


def health(r: random.Random) -> str:
    s = slots(r, "health")
    hook = r.choice(HEALTH_HOOKS).format(**s)
    t = r.choice([
        "{hook_cap}.",
        "Medicare Alert: {hook}.",
        "{name}, {hook}.",
        "Health Notice: {hook}. Offer ends in {hours} hrs.",
        "{hook_cap}. Limited supply!",
        "Senior Benefits: {hook}.",
        "{hook_cap}. Call {phone} to speak to an agent.",
        "Pharmacy update: {hook}.",
    ])
    return t.format(hook=hook, hook_cap=hook[:1].upper() + hook[1:], **s)


GENERATORS = {"government_threat": government_threat, "irs": irs, "id_request": id_request, "health": health}


def style(r: random.Random, text: str, scenario: str) -> str:
    s = slots(r, scenario)
    text = r.choice(OPENERS).format(**s) + text + r.choice(CLOSERS).format(**s)
    mode = r.random()
    if mode < 0.15:
        text = text.upper()
    elif mode < 0.25:
        text = text.lower()
    if r.random() < 0.1:
        text += " " + r.choice(["⚠️", "🚨", "❗", "‼️", "📞", "🔒"])
    return re.sub(r"\s+", " ", text.replace("..", ".")).strip()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9$]+", " ", s.lower()).strip()


def row(message: str, scenario: str) -> dict:
    label, name, ftc = LABELS[scenario]
    return {
        "id": "s" + hashlib.sha1(f"govhealthid|train|{message}".encode("utf-8")).hexdigest()[:12],
        "message": message,
        "label_class": label,
        "category_name": name,
        "ftc_subcategory": ftc,
        "label_method": "template",
        "label_confidence": 1.0,
        "is_spam": 1,
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
    for name in ("scam_categories_100k_full.csv", "potential_threat_synthetic.csv", "potential_threat_eval.csv"):
        path = data_dir / name
        if path.exists():
            with path.open(encoding="utf-8", newline="") as f:
                seen.update(norm(r["message"]) for r in csv.DictReader(f))
    return seen


def build(rng: random.Random, reserved: set[str]) -> list[dict]:
    rows: list[dict] = []
    seen = set(reserved)
    for scenario, make in GENERATORS.items():
        made = tries = 0
        while made < PER_SCENARIO and tries < PER_SCENARIO * 200:
            tries += 1
            msg = style(rng, make(rng), scenario)
            key = norm(msg)
            if key in seen:
                continue
            seen.add(key)
            rows.append(row(msg, scenario))
            made += 1
        if made < PER_SCENARIO:
            raise SystemExit(f"{scenario}: only {made}/{PER_SCENARIO} unique rows; add templates")
    rng.shuffle(rows)
    return rows


def main() -> None:
    here = Path(__file__).resolve().parent
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else here
    out.mkdir(parents=True, exist_ok=True)
    rows = build(random.Random(SEED), existing_keys(here))
    with (out / "gov_health_id_scam_synthetic.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"gov_health_id_scam_synthetic.csv: {len(rows)} rows, {PER_SCENARIO} per scenario, all scam")


if __name__ == "__main__":
    main()
