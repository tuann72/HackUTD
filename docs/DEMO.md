# T-Guard demo script

A 2–3 minute walkthrough for judges. **T-Guard** is a scam firewall for iMessage. Every message to a protected line goes through T-Guard first, and T-Guard either delivers it to the victim's inbox or blocks it as a **potential scam** before the victim ever sees it.

Tracks: **Safe Signal (T-Mobile)** for the problem, **Photon** for iMessage delivery (Spectrum webhooks), and **Vultr** for the classifier, which is trained and served there.

> **Be honest about what's live.** Until the classifier is trained and deployed on Vultr ([`classifier-service.md`](features/classifier-service.md), tasks 2.1 and 3.1), the gateway uses its built-in **keyword stub** (`stub@0`, shown on each card). Say so if asked. Don't claim MiniLM is running unless `CLASSIFIER_URL` is set and cards show its model name.

Always say **"potential scam"**, never "scam". The model flags; it doesn't prove.

## Setup (before judges arrive)

Three terminals, from the repo root. These are local-only defaults, and no accounts are needed.

```bash
# 1. Gateway (http://localhost:8787). Debug on so you can reset between runs.
cd services/gateway && npm install && cp -n .env.example .env
#   in .env: GATEWAY_DEBUG=1 and DEBUG_TOKEN=<any long random string>
npm run dev

# 2. Web app (http://localhost:3000), pointed at the local gateway
cd apps/web && npm install
echo 'NEXT_PUBLIC_API_URL=http://localhost:8787' > .env.local
npm run dev

# 3. Simulator (posts signed Photon-format webhooks to the gateway)
cd services/perpetrator-sim && npm install
npm run sim -- scenario smoke.jsonl     # sanity check: 3 messages show up on /
```

**With the deployed stack:** open the Vercel site instead of `localhost:3000`, and point the simulator at the VM with `GATEWAY_WEBHOOK_URL=https://<gateway-host>/webhooks/photon` and `PHOTON_WEBHOOK_SECRET=<the VM's secret>` (see [`services/gateway/DEPLOY.md`](../services/gateway/DEPLOY.md) step 8).

**Reset between runs** so the page starts empty:

```bash
curl -X POST -H "X-Debug-Token: $DEBUG_TOKEN" http://localhost:8787/debug/reset
```

Open `/` full-screen: the 3D scene on top, the inbox and blocked lists below.

## The walkthrough

Start the scenario at the top of the pitch, and talk over it. It runs about 80 s.

```bash
npm run sim -- scenario imessage-demo
```

| Time | On screen | Say |
|---|---|---|
| 0:00 | Empty page | "Scammers target older adults by text, posing as a grandson, the bank or the IRS, and they push people to act fast. T-Guard sits between the sender and the victim's iMessage inbox, like a carrier, and checks every message first." |
| ~0:00 | "Hi Mom! Are we still on for dinner Sunday?" lands in the **inbox** | "Normal messages go straight through." |
| ~0:07 | A **group chat** album: lake photos, with a "Group chat" badge and photo chips | "It handles real iMessage, including group chats, albums and photos." |
| ~0:14 | A ❤️ **reaction**, marked "Not checked" | "Reactions and attachments have no text to judge, so they're delivered and clearly labeled as not checked. No false sense of safety." |
| ~0:23 | "Hi Grandma it's me, I lost my phone…", delivered | "This is how the grandparent scam starts. On its own it's harmless, so it goes through." |
| ~0:31 | "…I need $800 in gift cards, please don't tell mom" turns **red and pops** in the scene, then lands in **Blocked** with a category badge and highlighted words | "This one is flagged as a **potential scam** and blocked before Grandma sees it. The badge shows the category, Imposter & Phishing, and the highlights show why: 'gift cards', 'don't tell'." |
| ~0:39 | The scammer's photo, delivered and not checked | "Each message is checked on its own. A scammer's photo with no text is delivered as Not checked, because the model reads text. We don't hold it back just because of who sent it." |
| ~0:48 | A `bit.ly` **link**, blocked, with the link defanged | "Phishing links get blocked, and in the blocked list they're disabled, so they can't be tapped." |
| ~0:56 | A "Bank Fraud Dept" **contact card**, with its number masked | "Scammers send fake contact cards so their number looks official. We show it and mask the number." |
| ~1:04 | "Your account is locked… verify your PIN", blocked | "Then the follow-up asks for a PIN. It's blocked." |
| ~1:12 | "See you Sunday, love you!", delivered | "The family conversation is untouched. Only the potential scams were held back." |

### The live moment (real iPhone → Photon → T-Guard)

Only do this once the Photon line is connected ([`photon-imessage.md`](features/photon-imessage.md), task 1.2).

1. Hand a judge (or use a teammate's) iPhone and say: "Text our protected number anything. Try a scam."
2. Good prompts: "I need you to buy gift cards, don't tell anyone", or a `bit.ly` link. Then a normal "hello".
3. It shows up within a few seconds, classified. Say: "That went from Apple, through Photon's webhook, to our gateway on Vultr, and was classified in real time. We never reply to the sender, and phone numbers never leave the gateway; the page only shows masked ones."

## Talking points (if asked)

- **Architecture:** the iPhone sends an iMessage to the Photon line. Photon sends a signed webhook to the gateway (TypeScript and Hono on a Vultr VM). The gateway asks the classifier (Python on Vultr), applies the deliver/block decision and stores it in SQLite. The web app (Next.js on Vercel) only reads the result.
- **Messages, not people:** we block messages, not people, so a spoofed or misjudged number is never cut off.
- **Fail open:** if the classifier is down, messages are delivered and marked **Unverified**. We never silently drop someone's messages.
- **Privacy:**
  - Webhooks are checked by HMAC signature with replay protection.
  - The browser never sees raw phone numbers, Apple IDs or Photon ids.
  - Contact-card numbers are masked before storage.
  - Only message text and an opaque id go to the classifier.
- **Why "potential":** the labels behind the model are machine-assigned, and the highlights are associations, not proof.

## Fallbacks

| If… | Do this |
|---|---|
| **Photon or the real line isn't working** | Skip the live moment. The simulator sends the exact Photon webhook format, signed the same way, so the gateway handles it identically. Say so. |
| **The classifier on Vultr is down or slow** | Nothing to do. The gateway fails open, and messages show as **Unverified**. Point it out as a feature. To show blocking anyway, unset `CLASSIFIER_URL` and restart; the keyword stub takes over. |
| **Venue Wi-Fi is down** | Run everything on one laptop: gateway, web and simulator over `localhost` (Setup above). No internet is needed. |
| **The gateway won't start or the API is unreachable** | Open the web app with no gateway: unset `NEXT_PUBLIC_API_URL`, or add `?source=replay` to the URL. It replays the contract fixture (blocked scams, a group album, a reaction, a contact card) on a loop. |
| **The page is cluttered from a previous run** | Run the `/debug/reset` curl above, then restart the scenario. |
| **A simulator send returns `401` or `400`** | `401`: the simulator's `PHOTON_WEBHOOK_SECRET` doesn't match the gateway's. `400` "stale timestamp": the laptop or VM clock is off by more than 5 minutes. |

## Pre-demo checklist

- [ ] `npm run sim -- scenario smoke.jsonl` shows 3 messages on `/`, then reset
- [ ] The scene animates and blocked messages pop
- [ ] `DEBUG_TOKEN` is exported in the shell you'll reset from
- [ ] (Live moment) A test iMessage to the Photon line shows up
- [ ] You know which classifier is live: the model name on a card (`stub@0`, or the MiniLM or TF-IDF model)
- [ ] A browser tab with `?source=replay` is ready as the last-resort fallback
