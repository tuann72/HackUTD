"""Builds rapid.jsonl: the Rapid fire dataset (200 complete sentences, 40% scam).

Hand-written for the simulation panel's Rapid fire button, so every message
reads as a full sentence. 80 scams across the scam groups in
data/scam_categories.csv and 120 ordinary texts. Senders, links and names are
fictional. Demo input only, never training data.

Usage: python3 -I data/message_bank/build_rapid.py
"""

import json
from pathlib import Path

OUT = Path(__file__).with_name("rapid.jsonl")

SCAMS = {
    "Imposter & Phishing": [
        "Your bank account has been temporarily locked due to suspicious activity, so please verify your identity at secure-acct-check.info within 24 hours.",
        "We noticed an unusual sign-in to your account from another state, and you must confirm your password at account-review-center.net to keep access.",
        "Your package could not be delivered because of an unpaid shipping fee, so please pay $1.99 at parcel-redelivery-desk.com to reschedule.",
        "This is the fraud department calling about a $2,340 charge on your card, so reply with your card number and PIN to cancel it.",
        "Your tax refund of $1,280 is on hold until you confirm your Social Security number at refund-status-portal.org today.",
        "The IRS has issued a warrant in your name for unpaid taxes, and you must pay with gift cards today to avoid arrest.",
        "Your computer has been infected with a virus, so call our support line now and we will remove it for a one-time fee of $199.",
        "Your Social Security number has been suspended because of illegal activity, so press 1 to speak with an agent immediately.",
        "We could not process your monthly payment, so update your billing details at billing-update-secure.com or your service will be cut off tonight.",
        "Your toll account shows an unpaid balance of $6.80, and a late fee of $50 will be added unless you pay at toll-balance-pay.net today.",
        "A new device was added to your account, and if this was not you, reply with the six-digit code we just sent to block it.",
        "Your Medicare card is expiring, so send us your full name, date of birth and Medicare number to receive the new card.",
        "This is your utility company, and your power will be shut off in 30 minutes unless you pay the overdue balance by prepaid card.",
        "Your email storage is full and new messages are being rejected, so log in at mailbox-quota-fix.com to restore your inbox.",
        "We are a charity collecting for wildfire victims, and you can donate right now by sending a gift card code to this number.",
        "Your direct deposit details need to be updated before Friday, so please reply with your bank routing and account numbers.",
        "Your phone number has been selected for a security audit, so read us the verification code you just received to keep your line active.",
        "Your credit card has been charged $899 for an order you did not place, so call us back right away to request a refund.",
        "Your driver's license will be suspended for an unpaid ticket unless you settle the $75 fine at dmv-fine-settlement.net.",
        "This is a debt collector, and a lawsuit will be filed against you tomorrow unless you pay $1,450 by wire transfer today.",
        "Your streaming subscription failed to renew, so enter your card details at renew-my-plan-now.com to avoid losing your account.",
        "Hi, it's your boss, and I need you to buy four $100 gift cards for a client right now and send me the codes.",
    ],
    "Prizes, Lotteries & Advance-Fee": [
        "Congratulations, you have won a $1,000 gift card, and you can claim it today at prize-claim-center.com before it expires.",
        "Your number was drawn in our national lottery for $850,000, and you only need to pay a $250 processing fee to release it.",
        "You have been selected for a free cruise for two, so reply YES and pay the small port fee to confirm your booking.",
        "A distant relative left you an inheritance of $4.5 million, and we need a $500 legal fee before we can transfer the funds.",
        "You qualify for a $9,000 government grant that never has to be repaid, so send the $150 filing fee to receive it.",
        "We are sending you a check for $3,200, so please deposit it and wire $2,700 back to us for the shipping costs.",
        "You are this week's lucky winner of a new tablet, and you just need to cover the $9.99 delivery charge to receive it.",
        "Your entry won second prize in our sweepstakes, so call our claims office today with your bank details to get your $25,000.",
        "You have unclaimed rewards worth $500 waiting for you, and they expire tonight unless you redeem them at rewards-vault-claim.net.",
        "A foreign businessman wants to share his fortune with you, and he only needs your account number to deposit $7 million.",
        "You have won a brand new car in our anniversary giveaway, so pay the $399 registration fee to schedule the delivery.",
        "Your phone number won our monthly cash drawing, and you can collect $5,000 by sending a $100 activation fee.",
    ],
    "Jobs, Business & Investment": [
        "We have a remote job that pays $500 a day for liking videos, so message us now to start earning today.",
        "Our crypto trading program guarantees a 40% return every week, and you can join today with just $250.",
        "You have been hired as a mystery shopper, so deposit the check we mailed and send the extra money back by wire.",
        "Make $3,000 a week from home with no experience needed, and you only pay $99 for the starter kit.",
        "This stock is about to triple tomorrow, so buy as many shares as you can before the announcement goes public.",
        "Our investment club doubles your money in 30 days, and we only have three spots left for new members.",
        "We saw your resume online and want to offer you a data entry job, but first you need to buy your own equipment from our vendor.",
        "You can earn passive income by sending us $1,000 in Bitcoin, and we will send $2,000 back within 48 hours.",
        "Join our team as a package reshipper, and we will pay you $40 for every parcel you forward to our overseas office.",
        "My uncle manages a secret gold fund that pays 15% every month, and I can get you in if you transfer the money today.",
        "Complete simple online tasks and earn $800 a day, but you have to top up your task account with $200 first.",
        "Our trading app has never lost money, and if you invest $500 now you will have $10,000 by the end of the month.",
    ],
    "Loans, Credit & Debt": [
        "You are pre-approved for a $15,000 personal loan with no credit check, and you just need to pay a $300 insurance fee first.",
        "We can erase all of your credit card debt in 30 days, so call now and pay our $499 enrollment fee to get started.",
        "Your credit score can be raised by 200 points in one week if you sign up for our repair program today.",
        "Stop your foreclosure today by sending your mortgage payments to us instead of your lender, and we will handle the rest.",
        "You qualify for a payday loan of $2,500 deposited in minutes, so reply with your bank login to receive the money.",
        "Your student loans are eligible for complete forgiveness, but you must pay a $199 processing fee by Friday.",
        "We are offering a guaranteed business loan of $50,000 with no paperwork, so send the $750 origination fee to claim it.",
        "Your credit report shows errors that are hurting your score, so give us your Social Security number and we will fix them.",
        "Lower your mortgage rate to 1% today, and all we need is your account number and the last four digits of your SSN.",
        "You have been approved for a credit card with a $10,000 limit, so pay the $89 activation fee to receive it in the mail.",
    ],
    "Health & Pharmacy": [
        "Lose 30 pounds in two weeks with our miracle pill, and your first bottle ships free when you enter your card details.",
        "Buy prescription medicine without a prescription at 80% off today from our online pharmacy.",
        "This natural supplement cures diabetes in seven days, and doctors don't want you to know about it.",
        "Your health insurance plan is being cancelled, so call now to enroll in our new plan before midnight.",
        "You are eligible for a free medical alert device, and you only need to give us your Medicare number to ship it.",
        "Our herbal drops reverse aging and restore your eyesight, so order now while supplies last.",
        "Get a free COVID test kit by confirming your insurance ID and date of birth at health-kit-claim.net.",
        "This one weird trick lowers your blood pressure overnight, so buy the guide now for only $19.",
    ],
    "Shopping & Product Offers": [
        "Your car's extended warranty is about to expire, so call us today to renew it before it is too late.",
        "Designer handbags are 90% off this weekend only, so order now at luxury-outlet-deals.shop before they sell out.",
        "You have been chosen to test the newest smartphone for free, and you only need to pay the $4.95 shipping fee.",
        "Your vacation package to the Bahamas is reserved, and you need to pay the $299 booking fee today to keep it.",
        "We are giving away free solar panels to homeowners in your area, so reply with your address and utility account number.",
        "Your antivirus subscription will auto-renew for $499 today, so call us now if you want to cancel and get a refund.",
        "Get the latest gaming console for just $49 today, because we are clearing out our warehouse stock.",
        "Your order of a 65-inch TV has shipped, and if you did not place it, click here to cancel and confirm your card.",
    ],
    "Internet, Telecom & Media": [
        "Your phone plan has been upgraded to unlimited for free, so text back your account PIN to activate it.",
        "Hot singles in your area want to meet you tonight, so sign up now for free with your credit card.",
        "You have won 500 free spins at our online casino, and you can claim them now with a $20 deposit.",
        "Your cable bill is overdue and your service will stop today unless you pay by gift card.",
        "Get every streaming channel for life with one payment of $59, so order now before the offer ends.",
    ],
    "Threats & Extortion": [
        "I have recorded you through your webcam, and I will send the video to all of your contacts unless you pay $1,500 in Bitcoin.",
        "We have your son, and if you want to see him again you will wire $5,000 and you will not call the police.",
        "I know where you live, and something bad will happen to your family unless you send the money by tonight.",
    ],
}

LEGIT = [
    "Hi Mom, I just landed and I'm waiting for my bag at the carousel.",
    "Are we still meeting for lunch at noon tomorrow?",
    "I picked up milk and eggs on the way home, so we don't need to stop at the store.",
    "Thanks for dinner last night, it was so good to see everyone.",
    "The meeting has been moved to 3 p.m. in the second-floor conference room.",
    "Can you send me the photos from the beach when you get a chance?",
    "I'm running about ten minutes late, so please save me a seat.",
    "Happy birthday, I hope you have a wonderful day with your family.",
    "Don't forget that your dentist appointment is on Thursday at 9 a.m.",
    "The kids had a great time at the park this afternoon.",
    "I left the spare key under the flower pot by the back door.",
    "Do you want me to bring anything for the potluck on Saturday?",
    "Your library books are due back next Monday.",
    "We finished painting the living room, and it looks amazing.",
    "I just started the new book you recommended, and I love it so far.",
    "Can you pick up Emma from soccer practice at five?",
    "The plumber said he can come by on Wednesday morning.",
    "Grandpa says thank you for the card, and he put it on the fridge.",
    "Let me know when you get home safely.",
    "I'm making lasagna tonight if you want to come over.",
    "The game starts at seven, so let's meet at the bar at six thirty.",
    "I found your scarf in my car after the concert.",
    "Our flight is delayed by an hour, but we should still make the connection.",
    "Could you water my plants while I'm away this weekend?",
    "The weather looks great for the hike on Sunday.",
    "I sent you the recipe for the banana bread by email.",
    "Your prescription is ready for pickup at the pharmacy counter.",
    "Thanks for helping me move last weekend, I owe you one.",
    "We're out of coffee, so can you grab some on your way back?",
    "The school called to say the field trip is next Friday.",
    "I'll call you after my shift ends tonight.",
    "Did you see the sunset tonight, because it was beautiful.",
    "My car is in the shop, so can I get a ride to work tomorrow?",
    "The new restaurant downtown is really good, and we should go together.",
    "I just got the job offer, and I start next month.",
    "Please remember to take out the trash before you leave.",
    "The baby finally fell asleep, so I'm going to rest for a bit.",
    "Your order from the bakery will be ready at 4 p.m.",
    "We're having a barbecue on Saturday, and you're welcome to join.",
    "I fixed the leaky faucet in the bathroom this morning.",
    "Can you remind me what time the recital starts?",
    "I loved the flowers you sent, they made my whole week.",
    "The dog needs to go to the vet for his shots next week.",
    "I'm at the grocery store, so do you need anything?",
    "Our team won the trivia night, and we got free dessert.",
    "I'll be working from home tomorrow if you need me.",
    "The concert tickets arrived in the mail today.",
    "Can we move our call to Thursday afternoon instead?",
    "I just finished my last exam, and I'm so relieved.",
    "Your sister called and asked you to call her back.",
    "The power came back on about twenty minutes ago.",
    "I'm heading to the gym, and I'll be back in an hour.",
    "We should plan a trip to the mountains this fall.",
    "The cat knocked a glass off the counter again.",
    "I booked the hotel for the wedding, so we're all set.",
    "Could you send me the address for the party?",
    "Dad's surgery went well, and he's resting now.",
    "The neighbors are having a yard sale this weekend.",
    "I saved you a plate of leftovers in the fridge.",
    "My train gets in at 6:15, so I'll walk from the station.",
    "Thanks for the reminder, I almost forgot about the meeting.",
    "The kids want pancakes for breakfast tomorrow.",
    "I'm so proud of you for finishing the marathon.",
    "Can you help me set up my new printer this weekend?",
    "The mechanic said the brakes are fine for now.",
    "We'll be at the lake house from Friday to Sunday.",
    "I'm going to bed early tonight because I'm exhausted.",
    "Your package was left with the front desk in the lobby.",
    "The movie starts at 8, so let's grab dinner before.",
    "I'll bring the folding chairs to the picnic.",
    "Mom wants to know if you're coming for Thanksgiving.",
    "The snow is really coming down, so drive carefully.",
    "I just walked the dog, so he's all set for the night.",
    "Your haircut appointment is confirmed for Saturday at 10 a.m.",
    "I finally cleaned out the garage this afternoon.",
    "Can you text me when you leave the office?",
    "The soup is on the stove, so help yourself.",
    "We got the keys to the new apartment today.",
    "I really enjoyed our walk this morning.",
    "The parent-teacher conference is on Tuesday evening.",
    "I left your jacket on the hook by the front door.",
    "The farmers market has fresh strawberries this week.",
    "Our anniversary dinner is booked for 7:30 on Friday.",
    "I'll pick up the cake from the bakery on my way.",
    "Did you remember to feed the fish this morning?",
    "The project deadline got pushed back to next Wednesday.",
    "Your brother says hi and wants to visit soon.",
    "I'm watching the game at Mike's place tonight.",
    "The garden is finally starting to bloom.",
    "Please call me when you have a minute to talk.",
    "We need to leave by 8 to beat the traffic.",
    "I just put a load of laundry in the dryer.",
    "The museum is free on the first Sunday of the month.",
    "Can you grab my mail while I'm out of town?",
    "I made it to the hotel, and the room is lovely.",
    "The kids are at Grandma's house until Sunday.",
    "I'm so sorry I missed your call earlier.",
    "Let's try the new coffee shop on Main Street.",
    "The doctor said my test results look normal.",
    "I'll be home in about fifteen minutes.",
    "We're having tacos for dinner tonight.",
    "The car needs an oil change sometime this month.",
    "I just signed up for the pottery class you mentioned.",
    "Can you believe how fast this year is going?",
    "The church bake sale raised over five hundred dollars.",
    "I'm picking up the dry cleaning on my lunch break.",
    "Your cousin's wedding invitation came in the mail.",
    "We should get the kids new shoes before school starts.",
    "I'll meet you at the entrance of the zoo at ten.",
    "The water heater was replaced, so we have hot water again.",
    "Thank you for checking in on me, I'm feeling much better.",
    "The book club is meeting at Sarah's house this month.",
    "I just booked our flights for the holidays.",
    "Can you help me pick out a gift for Dad?",
    "The bus was late, so I'll be a few minutes behind.",
    "We had so much fun at the fair this weekend.",
    "I'll send you the notes from today's class tonight.",
    "The new puppy is settling in really well.",
    "Please let me know if you need anything from the store.",
    "Good night, and I'll talk to you tomorrow.",
]


def main() -> None:
    rows = []
    for category, texts in SCAMS.items():
        rows += [{"text": t, "expected_label": "scam", "category": category} for t in texts]
    rows += [{"text": t, "expected_label": "legit", "category": None} for t in LEGIT]

    texts = [r["text"] for r in rows]
    assert len(set(texts)) == len(texts), "duplicate message"
    scams = sum(r["expected_label"] == "scam" for r in rows)
    assert (len(rows), scams) == (200, 80), (len(rows), scams)
    assert all(t[0].isupper() and t[-1] in ".?!" for t in texts), "not a complete sentence"

    with OUT.open("w", encoding="utf-8") as f:
        for i, r in enumerate(rows, 1):
            row = {"id": f"rapid-{i:03d}", **r, "source": "generated_rapid", "source_id": None}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} rows ({scams} scam, {len(rows) - scams} legit) -> {OUT.name}")


if __name__ == "__main__":
    main()
