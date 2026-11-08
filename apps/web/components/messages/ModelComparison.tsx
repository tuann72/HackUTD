/** Fixed results on 606 real texts no model trained on (156 scams, 450 harmless), block cutoff 0.70. See CHANGELOG.md. */
const TOTAL = 606;

export const MODEL_RESULTS = [
  { name: "Stacked LR + Nemotron", missed: 5, falseBlocks: 4, live: true },
  { name: "Stacked LR", missed: 8, falseBlocks: 4, live: false },
  { name: "TF-IDF + SGD", missed: 11, falseBlocks: 2, live: false },
  { name: "TF-IDF + LR", missed: 10, falseBlocks: 7, live: false },
  { name: "MiniLM + LR", missed: 9, falseBlocks: 29, live: false },
] as const;

const SCAMS = 156;

export function accuracy(missed: number, falseBlocks: number): number {
  return (TOTAL - missed - falseBlocks) / TOTAL;
}

export function f1(missed: number, falseBlocks: number): number {
  const caught = SCAMS - missed;
  return (2 * caught) / (2 * caught + falseBlocks + missed);
}

const percent = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The model name on a card, which opens a comparison of the models we tested. Nothing here changes which model runs. */
export function ModelComparison({ model }: { model: string }) {
  return (
    <details className="group min-w-0 open:basis-full">
      <summary className="cursor-pointer truncate text-right normal-case hover:text-ink" title="Model comparison">
        {model} <span aria-hidden className="inline-block group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-2 overflow-x-auto normal-case tracking-normal">
        <p className="mb-1 font-bold text-ink">Model comparison</p>
        <table className="w-full border-collapse text-left tabular-nums">
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="py-1 pr-2 font-medium">Model</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">Accuracy</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">F1</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">Missed</th>
              <th scope="col" className="py-1 pl-1 text-right font-medium">Wrongly blocked</th>
            </tr>
          </thead>
          <tbody>
            {MODEL_RESULTS.map((r) => (
              <tr key={r.name} className={r.live ? "font-bold text-ink" : undefined}>
                <th scope="row" className="py-0.5 pr-2 font-[inherit]">
                  {r.name}
                  {r.live && " (live)"}
                </th>
                <td className="px-1 py-0.5 text-right">{percent(accuracy(r.missed, r.falseBlocks))}</td>
                <td className="px-1 py-0.5 text-right">{percent(f1(r.missed, r.falseBlocks))}</td>
                <td className="px-1 py-0.5 text-right">{r.missed}</td>
                <td className="py-0.5 pl-1 text-right">{r.falseBlocks}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1">606 real texts no model trained on (156 scams), block cutoff 0.70. Only the live model checks your messages.</p>
      </div>
    </details>
  );
}
