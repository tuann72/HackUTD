"""FTC Consumer Sentinel report categories (category_definitions.pdf, Jan 2024) + keyword rules.

0 = ham. 1-17 = "Fraud Report Categories", 18-28 = "Other Report Categories" (document order).
The 7 "Identity Theft Types" are omitted: they describe misuse of stolen identity data
(e.g. a loan opened in your name), not a type of message someone receives.
"""
import re

CATEGORIES = {
    0: ("Ham (not spam)", "-"),
    1: ("Advance Payments for Credit Services", "Fraud"),
    2: ("Business and Job Opportunities", "Fraud"),
    3: ("Charitable Solicitations", "Fraud"),
    4: ("Foreign Money Offers and Fake Check Scams", "Fraud"),
    5: ("Grants", "Fraud"),
    6: ("Health Care", "Fraud"),
    7: ("Imposter Scams", "Fraud"),
    8: ("Internet Services", "Fraud"),
    9: ("Investment Related", "Fraud"),
    10: ("Magazines and Books", "Fraud"),
    11: ("Mortgage Foreclosure Relief and Debt Management", "Fraud"),
    12: ("Office Supplies and Services", "Fraud"),
    13: ("Online Shopping and Negative Reviews", "Fraud"),
    14: ("Prizes, Sweepstakes and Lotteries", "Fraud"),
    15: ("Tax Preparers", "Fraud"),
    16: ("Telephone and Mobile Services", "Fraud"),
    17: ("Travel, Vacations and Timeshare Plans", "Fraud"),
    18: ("Auto Related", "Other"),
    19: ("Banks and Lenders", "Other"),
    20: ("Computer Equipment and Software", "Other"),
    21: ("Credit Bureaus, Information Furnishers and Report Users", "Other"),
    22: ("Credit Cards and Loss Protection", "Other"),
    23: ("Debt Collection", "Other"),
    24: ("Education", "Other"),
    25: ("Funeral Services", "Other"),
    26: ("Home Repair, Improvement and Products", "Other"),
    27: ("Privacy, Data Security, and Cyber Threats", "Other"),
    28: ("Television and Electronic Media", "Other"),
}

# (pattern, weight). Patterns run case-insensitively on raw text; written to also match
# the Enron preprocessing (lowercase, punctuation replaced by spaces).
R = {
 1: [(r"guaranteed (loan|approval|credit)", 3), (r"(pay|small|processing|upfront|insurance) fee.{0,40}(loan|credit|approv)", 3),
     (r"(loan|credit).{0,40}(processing|upfront|advance) fee", 3), (r"bad credit.{0,20}(ok|no problem|approved|welcome)", 2),
     (r"(repair|fix|restore|improve|erase|clean) (your )?(bad )?credit", 3), (r"credit (repair|restoration)", 3), (r"pre.?approved", 1),
     (r"no credit check", 2), (r"instant (loan|credit)", 1)],
 2: [(r"part.?time", 2), (r"(daily|weekly) salary", 3), (r"work(ing)? (from|at) home", 3), (r"home.?based business", 3), (r"business opportunit", 3),
     (r"\bmlm\b|multi.?level marketing|network marketing", 3), (r"\b(job|position|vacancy|hiring|recruit)", 1), (r"be your own boss", 3),
     (r"make money (online|fast|from home|while)", 2), (r"earn .{0,20}(per|a|each|every) (day|week|hour)", 2), (r"(financial|regional) (manager|representative|agent)", 2),
     (r"(watch|like|review)(ing)? (youtube|videos|products).{0,30}(earn|kumita|₱|p\d)", 3), (r"kumita|bawat araw", 2), (r"mystery shopper", 2),
     (r"envelope stuffing|stuff envelopes|data entry", 3), (r"franchise", 2), (r"invention|idea promotion", 2), (r"residual income|extra income|lazy people|make (lots of|more) money", 2)],
 3: [(r"\bdonat(e|ion)", 3), (r"\bcharit(y|able)", 3), (r"relief (fund|effort|organization)", 3), (r"(victims|orphans|hurricane|earthquake|flood|typhoon) .{0,40}(help|support|give)", 2),
     (r"red cross|unicef|children in need", 2), (r"tax.?deductible", 2)],
 4: [(r"next of kin", 4), (r"\bbeneficiar", 3), (r"inheritance", 3), (r"barrister", 3), (r"\b\d{1,3} ?(million|m) (us )?(dollars|usd|euro)", 3),
     (r"(foreign|overseas) (partner|account)", 3), (r"transfer (of )?(the )?(funds|sum)", 3), (r"(diplomat|consignment|deceased|late (client|husband))", 2),
     (r"\b(nigeria|lagos|benin|ivory coast|sierra leone|ghana)\b", 2), (r"strictly confidential|risk.?free transaction", 2), (r"(fake|cashier.?s|certified) check", 2),
     (r"(overpa(id|yment)|wire (back|the difference))", 3), (r"percent of the (total|sum|funds)", 3), (r"dear (friend|beloved)", 1),
     (r"seek your (assistance|consent|cooperation|help|partnership)|honest and trust ?worthy|humbly|my late (husband|father)|assistance in a matter|business proposal|contacting you (believing|because)|(kenya|benin|togo|senegal|liberia|zimbabwe|south africa)", 3)],
 5: [(r"\bgrants?\b", 3), (r"free (government )?money", 3), (r"financial aid", 3), (r"student loan", 2), (r"(diploma|degree)s?\b.{0,60}(life experience|no (exams|classes|study)|non.?accredited|days|weeks)", 4),
     (r"(bachelors|masters|mba|doctorate|phd).{0,40}(degree|diploma)", 2), (r"university diploma", 3), (r"obtain a prosperous future", 3)],
 6: [(r"v[i1!]\W?a\W?g\W?r\W?a|vi ?ag ?ra|cialis|levitra|xanax|valium|vicodin|soma\b|ambien|phentermine|meridia|tramadol|propecia|regalis|vagra|viagr", 3),
     (r"c[il1]+\W?[a@]+\W?[l1]+\W?[il1]+\W?s|v\W?[il1]+\W?[a@]+\W?g\W?r+\W?[a@]|x+\W?a+\W?n+\W?a+\W?x|v[a@]+l+[il1]+u+m|[a@]mb[il1]+e+n|c[o0]de[il1]+ne|ph[a@]rm[o0]|meds+\b|p[il1]+r?[l1]+s\b", 3),
     (r"pharmac|phamacy|prescription|\bmeds\b|\bpills?\b|\brx\b|medication|drugstore", 2), (r"weight ?loss|lose (weight|\d+ ?(lbs|pounds|kg))|slimming|diet (pill|patch)|fat (burn|loss)", 3),
     (r"erect|impoten|penis|enlarge|male enhancement|sexual performance|stamina", 3), (r"herbal|supplement|hgh|anti.?aging|wrinkle|hair loss", 2),
     (r"health (insurance|plan)|medical discount|dental plan|telemedicine|cure|treatment", 1), (r"stop smoking|quit smoking", 2)],
 7: [(r"(account|card|wallet|access).{0,30}(suspend|lock|restrict|deactivat|on hold|frozen|limited)", 4), (r"(verify|confirm|update|validate) (your|the) (account|identity|details|information|records|address)", 3),
     (r"security (alert|check|notice|department)", 2), (r"\botp\b|one.time.pin", 3), (r"(gcash|maya|paypal|ebay|amazon|bdo|bpi|banco de oro|metrobank|landbank|barclays|chase|wells fargo|hsbc|citibank|bank of america|lloyds|natwest)\b", 2),
     (r"dear .{0,25}(customer|member|user|client)", 2), (r"\b(sss|irs|social security|dvla|lto|philhealth|pag.?ibig|gsis|medicare)\b", 2),
     (r"(parcel|package|shipment|delivery).{0,60}(fee|address|hold|could not|redeliver|customs)", 4), (r"\b(usps|royal mail|dhl|fedex|lbc|j&t|phlpost|ups|evri)\b", 2),
     (r"(toll|traffic ticket|violation|fine).{0,60}(pay|unpaid|overdue|penalt)", 4), (r"hi (mum|mom|dad)|new number|dropped my phone", 4),
     (r"(tech|technical) support|microsoft (support|technician)", 3), (r"(fancy|likes?|crush on) you.{0,60}(call|find out)|someone has contacted our dating", 3),
     (r"\bna.?lock|i.?verify|kahina.?hinala", 3), (r"wrong number|is this .{0,10}\?|we met at", 2), (r"re.?verif|kyc", 3)],
 8: [(r"(lazy people|wish to make (lots of )?money)", 0), (r"(date|dating|flirt|hook ?up|meet).{0,40}(girls|women|singles|men|sex|tonight|area)|(girls|women|singles|sex addicts|sexoholics).{0,40}(date|meet|area|want)", 3),
     (r"\bsex\b|fuck|bang all night|horny|\bslut", 2), (r"s[!1]ot|panalo|bagong player|surewin|good luck!", 2),
     (r"\bslots?\b|casino|jackpot|\bbet(s|ting)?\b|poker|hold.?em|blackjack|roulette|sugal|tumaya|gambl|jili|sabong|fishing games?", 3),
     (r"(welcome|deposit|daily|first) bonus|cashback|free spins|magdeposito|magrehistro|deposito", 3), (r"\b\d{2,3}% bonus", 2),
     (r"(seo|search engine|top 10 (ranking|position)|google ranking|web ?site (design|traffic|promotion)|web traffic)", 3),
     (r"(email|e mail|bulk) (marketing|addresses|list|advertis)|million (targeted )?(email|e mail) addresses", 3), (r"domain name|web hosting|hosting plan", 2),
     (r"(adult|xxx|porn|p0rn|sex(y|ual)? (videos|pics|site)|webcam|live cam|nude|n aked|hardcore|teen|horny|whores|lesbian)", 2), (r"(membership|vip pass|lifetime access)", 1),
     (r"dating (site|service)|singles in your area|find a (partner|date)", 1), (r"social network|online gaming|internet (gaming|service)", 1)],
 9: [(r"reflnance|re.?finance", 0), (r"stock|shares|\bsymbol\b|investor|ticker|otc|pink sheets|\bnasdaq\b|trading alert|market (watch|alert)", 2), (r"(target|current) price", 3),
     (r"\b(bitcoin|btc|crypto|usdt|ethereum|forex|binary options?)\b", 3), (r"guaranteed (returns|profit)|\d{2,3}% (weekly|daily|monthly)? ?returns?", 3),
     (r"\binvest(ment|ing)?\b", 2), (r"day trading|gold|precious metals|rare coins|gems|options trading", 1), (r"(strong|hot) buy|about to (explode|soar)|huge (gains|move)", 3)],
 10: [(r"magazine|subscription to .{0,20}(magazine|journal|newspaper)|e.?books?|newsletter subscription|publication|manual update", 3), (r"books?\b", 1), (r"(free|special) issue", 2),
      (r"(harry potter|bestseller|novel|reader)", 1)],
 11: [(r"ref[il1]nanc|mortgage|home loan|foreclos|re.?fi\b|\blender", 3), (r"lower (your )?(monthly )?(payment|interest rate)|interest rates? (as low as|from)", 2),
      (r"debt (relief|consolidation|management|settlement|free)|consolidate (your )?(debt|bills)|(eliminate|reduce|cut) (your )?debt", 4), (r"loan modification", 3)],
 12: [(r"toner|ink (cartridge|jet)|printer (ink|supplies)|copier|office supplies|fax (paper|broadcast)", 4), (r"yellow pages?|business directory|directory listing", 3),
      (r"(equipment|maintenance) contract", 2), (r"(business cards|letterhead|invoice for your listing)", 2)],
 13: [(r"replica|rolex|breitling|cartier|omega watch|handbags?|louis vuitton|designer (bags|watches)", 3), (r"cigarettes|marlboro|camel|newports", 3),
      (r"(sale|discount|% off|percent off|clearance|deals?|vouchers?|coupon|free shipping)", 1), (r"\b(shopee|lazada|walmart|tesco|argos|target|zalora|sm store)\b", 2),
      (r"your order|order now|shop now|buy now|online store|catalog|wholesale", 1), (r"(review|rating).{0,30}(earn|paid|commission)", 1)],
 14: [(r"lottery|lotto|sweepstake|raffle|\bdraw(n)?\b", 3), (r"(you|u|number|email).{0,20}(have |has )?(won|been (selected|awarded|chosen))", 4), (r"\bwinners?\b|\bnanalo\b", 2),
      (r"\bprize|award(ed)?|claim (code|no|your|now)|to claim|await collection|unclaimed", 3), (r"congratulation", 2), (r"guaranteed.{0,30}(cash|£|\$|prize)", 3),
      (r"(free entry|chance to win|win (a|an|the)? ?(£|\$|₱|ipod|iphone|cash|car|holiday|trip))", 2), (r"selected (to receive|for)", 2), (r"gift card|giveaway", 1)],
 15: [(r"tax (refund|return|preparer|rebate|relief|filing)|\birs\b|hmrc|bureau of internal revenue|internal revenue", 4), (r"refund of", 1), (r"(owe|unpaid|back) tax", 3), (r"1040|tax (id|form)", 2)],
 16: [(r"ringtone|\btones?\b|polyphonic|wallpaper|logos", 2), (r"(txt|text|send|reply) [A-Z0-9]{2,10} (to|2) \d{4,6}", 3), (r"\d+p ?(/|per) ?(msg|min|wk|week)|£\d\.\d\d ?(/|per) ?(msg|min|wk|week)|150ppm|ppm\b", 3),
      (r"txt stop|text stop|send stop|stop to (end|opt|unsubscribe)|unsubscribe txt|to opt out", 2), (r"(mobile|phone|tariff|minutes|\bmins\b|upgrade|camera phone|handset|sim\b|network|prepaid|load)", 1),
      (r"(double mins|free (txt|texts|minutes)|unlimited (data|calls|texts))", 3), (r"(landline|call from a landline|premium rate|0[89]0\d{7,})", 2), (r"chat (line|now)|txt chat|text chat|send chat", 2)],
 17: [(r"vacation|holiday|cruise|timeshare|resort|airfare|flight|hotel|getaway|travel|trip to|\bairline", 2), (r"(free|discount(ed)?|cheap) (vacation|holiday|cruise|trip|flights?|travel)", 3)],
 18: [(r"(car|auto|vehicle)('?s)? (warranty|insurance|loan|financing|lease|extended)", 4), (r"extended warranty", 3), (r"(used|new) cars?|car dealer|test drive|\bvehicle\b", 2),
      (r"(mechanic|oil change|tires|auto repair)", 2), (r"\b(toyota|honda|ford|nissan|mitsubishi|fortuner|nmax|yamaha)\b", 1)],
 19: [(r"payday (loan|advance)|cash advance|title loan|personal loan|business loan|quick (cash|loan)|fast loan|loan (app|approval|up to)", 4), (r"\bloans?\b", 2),
      (r"need cash|low interest|no collateral|overdraft|credit union", 2), (r"(bank|savings) account (offer|bonus)|open an account", 1)],
 20: [(r"software|oem|windows (xp|vista|7|10)|microsoft office|office (xp|20\d\d)|adobe|photoshop|macromedia|autocad|corel|norton|antivirus|mcafee", 3),
      (r"(laptop|computer|pc|notebook|printer|hard drive|memory|hardware)s?\b", 1), (r"(download|license|cd.?key|serial)", 1)],
 21: [(r"credit (report|score|rating|bureau|check)|free (annual )?credit|equifax|experian|transunion|fico", 4)],
 22: [(r"credit card|visa|mastercard|\bamex\b|card (offer|application|holder)|platinum card|card (is|has been) (blocked|locked|suspended)", 3),
      (r"balance transfer|0% (intro|apr)", 2), (r"(loss protection|card protection|fraud protection|identity (theft )?protection)", 3), (r"phishing", 2)],
 23: [(r"debt collect|collection (agency|notice|department)|final (demand|notice)|outstanding (balance|debt|amount)|past due", 4), (r"(legal action|lawsuit|warrant|arrest|court).{0,60}(debt|pay|balance)", 3),
      (r"(pay|settle).{0,30}(immediately|today).{0,40}(avoid|or)", 2)],
 24: [(r"(online|vocational|trade|nursing|medical|technical) (school|course|degree|program|training)|enroll|tuition|scholarship|accredit|college|university|certification", 2),
      (r"(class|course|lesson|tutor|training|seminar|webinar)", 1)],
 25: [(r"funeral|burial|cremation|memorial (plan|park)|casket|cemetery|pre.?need plan|final expense", 5)],
 26: [(r"home (warranty|repair|improvement|security|protection|insurance)|roof|solar|windows and doors|contractor|remodel|plumb|hvac|air condition|furniture|appliance|mattress", 3),
      (r"(condo|house and lot|real estate|pre.?selling|resale|office space|commercial lots?|townhouse|apartment for (sale|rent)|property for sale|sq\.? ?m)", 3)],
 27: [(r"returned mail|mail delivery (failed|subsystem)|delivery (status notification|failure)|undeliver(able|ed) mail|message (could not be|was not) delivered", 3),
     (r"virus|malware|spyware|trojan|hacked|hacker|compromised|infected|security (scan|software)|firewall|spam (filter|blocker)|anti.?spam|privacy|data breach|webcam footage|ransomware", 3),
      (r"(stop|block) (spam|pop.?ups|viruses)|pop.?up", 2)],
 28: [(r"(satellite|cable|dish|direct ?tv|streaming|netflix|spotify|disney|hbo|tv (channels|service|package))", 3), (r"(dvd|cd|mp3|music|movies?|videos?|video clips|songs?|chart hits|jamster)", 1),
      (r"(free|download).{0,20}(music|movies|mp3|dvd|songs)", 3)],
}
# every pattern must start at a word boundary ("roof" must not match "proof")
RULES = {c: [(re.compile(r"(?<![a-z])(?:" + p + ")", re.I), w) for p, w in pats if w > 0] for c, pats in R.items()}
# tie-break priority: specific scams first, broad buckets last
PRIORITY = [4, 25, 15, 11, 21, 18, 12, 3, 10, 23, 1, 5, 9, 14, 7, 20, 27, 22, 2, 6, 17, 19, 16, 28, 26, 24, 8, 13]
PRI = {c: i for i, c in enumerate(PRIORITY)}

def score(text):
    sc, hits = {}, {}
    for c, rules in RULES.items():
        m = [w for rx, w in rules if rx.search(text)]
        sc[c], hits[c] = sum(m), len(m)
    return sc, hits

def classify(text, min_score=3, min_margin=2):
    """Return (category or None, confident?).
    Confident = score >= min_score, beats runner-up by min_margin, and (for long texts, where
    word-salad padding causes stray hits) at least two distinct patterns agree."""
    s, h = score(text)
    ranked = sorted(s, key=lambda c: (-s[c], PRI[c]))
    best, second = ranked[0], ranked[1]
    if s[best] == 0:
        return None, False
    conf = s[best] >= min_score and s[best] - s[second] >= min_margin and (h[best] >= 2 or len(text) < 300)
    return best, conf
