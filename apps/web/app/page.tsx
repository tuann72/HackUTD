import Link from "next/link";

// Placeholder home. The 3D scene (docs/features/initial-3d-scene.md) may take
// this route; the MVP message list lives at /messages.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">T-Gate</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Intercepts texts to the victim number, flags potential scams and blocks them before they arrive.
      </p>
      <nav className="flex gap-4">
        <Link className="rounded-md bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900" href="/messages">
          Messages
        </Link>
        <Link className="rounded-md border border-zinc-300 px-4 py-2 dark:border-zinc-700" href="/scene">
          Scene
        </Link>
      </nav>
    </main>
  );
}
