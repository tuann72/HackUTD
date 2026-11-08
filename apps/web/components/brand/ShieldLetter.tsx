/**
 * The "U" in GUARD, drawn as T-Guard's magenta shield (the Lucide `shield`
 * outline, ISC license, filled). Exactly as tall as the surrounding capitals in any font (CSS `cap` unit, so
 * Anton on the landing page and Inter in the headers both match), sitting
 * on the baseline; screen readers still get the letter "U".
 */
export function ShieldLetter({ className = "" }: { className?: string }) {
  return (
    <>
      <span className="sr-only">U</span>
      <svg
        aria-hidden
        viewBox="3.6 1.6 16.8 20.8"
        className={`inline-block h-[0.8em] w-auto align-baseline ${className}`}
        // 1cap = the font's cap height; browsers without `cap` drop it and keep 0.8em.
        style={{ height: "1cap" }}
      >
        <path
          fill="#e20074"
          d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        />
      </svg>
    </>
  );
}
