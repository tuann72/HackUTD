import type { Metadata } from "next";
import Link from "next/link";
import { Anton, Archivo } from "next/font/google";
import { Blocks } from "@/components/landing/Blocks";
import { ShieldLetter } from "@/components/brand/ShieldLetter";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const archivo = Archivo({ weight: ["700", "800"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "T-Guard",
  description: "T-Guard catches potential scam messages before they reach you.",
};

/** Landing page. Start opens the live scene and message lists at /messages. */
export default function Landing() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col-reverse bg-[#f6efec] text-[#100f0d] md:flex-row">
      <section className="flex flex-1 flex-col justify-end px-6 pb-12 pt-10 sm:px-12 md:pb-[12vh]">
        <h1 className={`${anton.className} text-[clamp(4.5rem,13vw,11rem)] uppercase leading-[0.85] tracking-tight`}>
          T-G
          <ShieldLetter className="mx-[0.03em]" />
          ard
        </h1>
        <p className={`${archivo.className} mt-5 text-base font-extrabold uppercase tracking-tight text-[#5a5250] sm:text-xl`}>
          Security that moves with you.
        </p>
        <Link
          href="/messages"
          className={`${archivo.className} group mt-10 inline-flex w-fit items-center gap-3 bg-[#100f0d] px-8 py-4 text-lg font-bold uppercase tracking-wide text-[#f6efec] transition-colors hover:bg-[#e1346f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e1346f]`}
        >
          Start
          <span aria-hidden className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>
      </section>
      <section className="h-[42dvh] md:h-auto md:flex-1">
        <Blocks />
      </section>
    </main>
  );
}
