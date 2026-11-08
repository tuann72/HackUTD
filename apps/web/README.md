# T-Gate web app (`apps/web`)

Next.js 16 (App Router, React 19, Tailwind 4). It hosts:

| Route | What | Plan |
|---|---|---|
| `/` | Placeholder home. The 3D scene may take this route | [`initial-3d-scene.md`](../../docs/features/initial-3d-scene.md) |
| `/messages` | MVP message list: inbox (delivered) and blocked | [`twilio-mvp.md`](../../docs/features/twilio-mvp.md), tasks 1.3 and 2.2 |

The 3D-scene packages are already installed, so scene work doesn't need to edit `package.json`: `@react-three/fiber` 9, `@react-three/drei` 10, `three`, `motion` (`motion/react`) and `maath`. Load the `<Canvas>` from a client component with `next/dynamic` and `{ ssr: false }`. Don't use `framer-motion-3d`.

## Commands

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # vitest
npm run typecheck
npm run lint
npm run build
npm run check:contract # fails if lib/messages/fixture.v1.json is stale
npm run sync:contract  # re-copies the fixture from contracts/
```

## Data: `lib/messages`

The only data layer. The web app talks to the gateway's read-only `GET /api/messages` ([`contracts/`](../../contracts/README.md)) and never writes to it, calls Twilio, or decides scam vs. legitimate.

```tsx
"use client";
import { useMessages, isPotentialScam, isUnverified } from "@/lib/messages";

const { messages, mode, error } = useMessages({
  intervalMs: 1500,
  // For animation: called with what changed since the last poll.
  onChanges: (changes) => {
    for (const c of changes) {
      if (c.type === "received") { /* launch a projectile for c.message */ }
      if (c.type === "resolved") { /* c.message.action is "delivered" or "blocked" */ }
    }
  },
});
```

**Sources** (`lib/messages/source.ts`):

| Source | When | What |
|---|---|---|
| `live` | `NEXT_PUBLIC_API_URL` is set, or `?source=live` | Polls `${NEXT_PUBLIC_API_URL}/api/messages` |
| `replay` | Default when no URL is set, or `?source=replay` | Replays the contract fixture: a new message every 3 s, pending for 1.2 s, then delivered or blocked. Loops with fresh ids |
| `static` | `?source=static` | The fixture as-is |

Display helpers: `isPotentialScam(m)` (the gateway's label is `scam`; say "potential scam" on screen) and `isUnverified(m)` (delivered because the classifier was down).

## Config

Copy `.env.example` to `.env.local`. `NEXT_PUBLIC_API_URL` is the gateway base URL, for example `http://localhost:8787`. It ships to the browser, so never put secrets in `NEXT_PUBLIC_` variables.

## Deploy (Vercel)

The repo-root [`vercel.json`](../../vercel.json) deploys only this app, as a single Vercel service named `web` that serves every path. The gateway and the classifier run on Vultr, not on Vercel. The browser calls the gateway directly, so there are no Vercel service bindings.

1. Import the repo into Vercel and keep the project's Root Directory as the repo root, so `vercel.json` is picked up.
2. Set `NEXT_PUBLIC_API_URL` to the gateway's public **HTTPS** URL (for example `https://<gateway-host>`) for Production and Preview. It's inlined at build time, so redeploy after changing it. An `http://` URL fails from an HTTPS page as mixed content.
3. On the gateway, add the Vercel domain to `CORS_ORIGINS` (comma-separated, for example `https://<project>.vercel.app`). Without it, `/messages` shows "Couldn't refresh messages".

With `NEXT_PUBLIC_API_URL` unset, the deploy still works and replays the fixture.

`AGENTS.md` in this folder is written by `next dev` and points agents at the bundled Next.js 16 docs in `node_modules/next/dist/docs/`.
