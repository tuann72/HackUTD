"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ShieldLetter } from "./ShieldLetter";

const NAV = [
  { href: "/messages", label: "Messages" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/voice", label: "Voice results" },
] as const;

/**
 * The header shared by /messages and /dashboard: the wordmark, the page tabs (a pink
 * bar marks the current page) and an optional slot on the right.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  const path = usePathname();
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-rule px-4 sm:gap-8 sm:px-6">
      <Link
        href="/"
        className="whitespace-nowrap text-2xl font-black tracking-[-0.06em] text-ink transition-colors hover:text-hot focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hot"
      >
        T-G<ShieldLetter className="mx-[0.04em]" />ARD
      </Link>
      <nav aria-label="Pages" className="-mb-px flex h-full min-w-0 items-stretch gap-1 overflow-x-auto">
        {NAV.map((item) => {
          const active = path === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center whitespace-nowrap px-3 font-label text-[11px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hot ${
                active ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
              {active && (
                <motion.span
                  layoutId="app-nav-bar"
                  aria-hidden
                  className="absolute inset-x-3 bottom-0 h-[3px] bg-hot"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
            </Link>
          );
        })}
      </nav>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
