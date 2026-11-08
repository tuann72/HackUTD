# Feature: Initial 3D scene

- **Slug:** `initial-3d-scene` (used in branch names: `<type>/initial-3d-scene-<short-task>`)
- **Phase:** Later (the 3D scene is parked until the MVP works; see [`CHANGELOG.md`, "MVP UI is a basic Next.js message list; 3D scene parked"](../../CHANGELOG.md#2026-11-07-mvp-ui-is-a-basic-nextjs-message-list-3d-scene-parked))
- **Status:** Not started
- **Owner:** TBD

## Goal

Make the simplest possible 3D scene that shows T-Gate working. It has two blobs: a **pink blob for the victim** and a **sender blob that shoots messages** at it. Each message is a small projectile. **Red** means the gateway flagged it as a **potential scam**. Each message either **goes through** to the victim or gets **blocked** before it arrives. Anyone watching can see at a glance that T-Gate stops potential scams before they reach the victim and lets everything else through.

This is the first version of the scene described in [`CHANGELOG.md`, "3D scene (simple, React Three Fiber)"](../../CHANGELOG.md#3d-scene-simple-react-three-fiber). It follows the stack and decoupling rules in [`AGENTS.md`](../../AGENTS.md#proposed-architecture-interception-gateway-and-demo-scene-not-agreed): Next.js, React Three Fiber, `motion/react` for the DOM layer. The scene consumes events only and contains no business logic.

## Scene design (Tuan, 2026-11-07)

- **Victim:** one **pink** blob in the scene. It idles (gentle bob) and reacts with a small bounce when a message reaches it.
- **Sender:** one blob that shoots messages at the victim. It isn't colored red itself (Tuan dropped that idea). Its color is TBD, and it should be neutral so it doesn't clash with the red messages.
- **Messages:** each message is a small projectile, a blob or orb, that flies from the sender toward the victim.
  - **Red** = flagged as a **potential scam**.
  - **Not flagged:** a neutral or calm color (TBD, for example white or soft blue).
- **Outcome:**
  - **Goes through:** the projectile reaches the victim and is absorbed, and the victim bounces.
  - **Blocked:** the projectile stops short of the victim, shows a "Blocked" stamp and pops. An optional shield flash around the victim is TBD.
- **Wording:** always say **"potential scam"**, never "scam", in on-screen labels and stamps (for example, "Potential scam · Blocked"). The classifier can be wrong, and the wording should reflect that.
- **Where color and outcome come from:** both come straight from the event. Color comes from the classification label, and the outcome comes from the event's `action` (`delivered` / `blocked`). Normally red messages are blocked and the rest go through. The scene never decides either one itself.

## Out of scope

- Several senders, wandering crowds, or public senders spawning (later scope: [live public demo](../../AGENTS.md#later-live-public-demo)).
- Chat bubbles with the full message text. Showing a short preview on hover or as a label is TBD (see open questions).
- Counters, a HUD, or a with/without T-Gate comparison view. These are possible follow-ups.
- The blocked-scams panel (`/blocked`), the scam notice, and keyword highlights. Those are separate features.
- Anything on the gateway, simulator or classifier side.

## Open questions

- **When it starts:** the 3D scene is parked for later scope. Start this plan only once the Twilio MVP works end to end, or once Tuan un-parks it.
- **Data source:** the MVP has no event stream. Its basic UI polls `GET /api/messages`. This scene could poll that same API first (as a stand-in for task 4.1) or wait for the event stream (TBD).
- **Route:** the MVP's basic message list owns the web app first. The scene's route (`/` or `/scene`) is TBD.
- **Event contract v1:** this plan assumes `message.delivered` / `message.blocked` events with `action`, a label and an opaque message id, as in `CHANGELOG.md`. The contract file (`contracts/events.v1.schema.json`) doesn't exist yet. Until it does, fixtures follow the shape in `CHANGELOG.md`.
- **Colors:** the sender blob's color, and the color of messages that aren't flagged. Red for potential scam and pink for the victim are decided.
- **Message text:** whether the projectile shows any text (none, a short truncated label, or a hover preview).
- **Shield flash** on block: yes or no.
- **Speed:** how fast messages are shot during the demo, and whether there's a slow first pass followed by a faster one.

## Tasks

Tasks are grouped into ordered stages. Tasks in the same stage can run **in parallel**. A stage starts only when the stages it depends on are done.

### Stage 1: Foundations

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Add R3F + drei + Motion to the web app and put an empty client-only `<Canvas>` on a scene route | Scene un-parked; the MVP web app exists | 1.2 | Not started | | | |
| 1.2 | Scene fixtures: a mock event sequence of potential-scam and other messages, each delivered or blocked | — | 1.1 | Not started | | | |

### Stage 2: Scene pieces

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Victim (pink) and sender blobs: placement, idle bob, victim bounce on receive | 1.1 | 2.2 | Not started | | | |
| 2.2 | Message projectile: fly sender → victim, red vs. neutral color, "goes through" and "blocked + pop" animations | 1.1 | 2.1 | Not started | | | |

### Stage 3: Wire it up

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Mock event source → client store → scene: each fixture event fires a projectile, with color and outcome taken from the event | 1.2, 2.1, 2.2 | — | Not started | | | |

### Stage 4: Live (after the gateway exists)

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 4.1 | Live event source via `NEXT_PUBLIC_EVENTS_URL`, falling back to mock when unset | 3.1, gateway event stream | — | Not started | | | |

## Task details

### 1.1 Add the scene to the web app

- **What:** in the MVP's Next.js app (`apps/web/`, created by the Twilio MVP plan), add `@react-three/fiber` (v9+, React 19), `@react-three/drei` and `motion`. The scene route loads it as a client component through `next/dynamic` with `ssr: false`. Don't use `framer-motion-3d`.
- **Files:** `apps/web/package.json`, the scene route and `apps/web/components/scene/`.
- **Done when:** `npm run dev` shows an empty canvas with a background and lighting on the scene route, and `npm run build` passes.

### 1.2 Scene fixtures

- **What:** a JSON file of about 10–20 events in the `CHANGELOG.md` event shape. It mixes potential-scam (blocked) messages with other (delivered) messages, uses opaque ids and masked senders only, and contains no real phone numbers. Message text can come from the real `test` split or be written by hand.
- **Files:** `contracts/fixtures/scene-initial.json` (or wherever the contract work puts fixtures).
- **Done when:** the file validates against the event schema once that exists, and includes both outcomes.

### 2.1 Victim and sender blobs

- **What:** a `<Blob>` component (sphere with simple eyes), used once for the pink victim and once for the sender. They idle with a gentle bob through `useFrame` and damping (for example, `maath` `easing.damp3`). The victim exposes a "received" reaction (bounce).
- **Files:** `apps/web/components/scene/Blob.tsx` and the scene layout.
- **Done when:** both blobs render, bob, and the victim bounces when triggered by hand.

### 2.2 Message projectile

- **What:** a `<MessageShot>` component that travels from the sender to the victim in `useFrame`. Red when the event marks it as a potential scam, neutral otherwise. **Goes through:** reaches the victim, disappears, and calls the victim's bounce. **Blocked:** stops short of the victim, shows a "Potential scam · Blocked" stamp (drei `<Html>` + `motion/react`) and pops.
- **Files:** `apps/web/components/scene/MessageShot.tsx`.
- **Done when:** both outcomes can be triggered by hand and look right.

### 3.1 Wire the mock event source

- **What:** a small client store (Zustand or similar, TBD) that holds in-flight messages. A mock source replays the fixture on a timer and writes into the store. The scene renders one projectile per message. Color and outcome are read from the event and never computed.
- **Files:** `apps/web/lib/events/*`, `apps/web/lib/store.ts`, scene wiring.
- **Done when:** loading the scene route with `?source=mock` (or with no URL set) loops through the fixture, showing red projectiles blocked and the others reaching the victim.

### 4.1 Live event source

- **What:** connect to the gateway's event stream (WebSocket or SSE, TBD) from `NEXT_PUBLIC_EVENTS_URL`, reconnect with backoff, and keep idling when disconnected.
- **Files:** `apps/web/lib/events/*`.
- **Done when:** a simulated message sent through the real gateway shows up in the scene.

## Progress notes

- **2026-11-07:** rebased onto the merged Twilio MVP plan (PR #1). Phase set to Later, because that PR parked the 3D scene.
- **2026-11-07:** plan written from Tuan's scene description: one pink victim blob, one sender blob that shoots messages, red = potential scam, each message goes through or gets blocked.
