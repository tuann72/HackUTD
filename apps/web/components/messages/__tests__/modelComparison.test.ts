import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODEL_RESULTS, ModelComparison, accuracy, f1 } from "../ModelComparison";

describe("model comparison", () => {
  it("computes the measured figures from the error counts", () => {
    expect(accuracy(5, 4)).toBeCloseTo(0.9851, 4);
    expect(f1(5, 4)).toBeCloseTo(0.9711, 4);
    expect(accuracy(8, 4)).toBeCloseTo(0.9802, 4);
    expect(f1(8, 4)).toBeCloseTo(0.961, 3);
  });

  it("marks exactly one model as live", () => {
    expect(MODEL_RESULTS.filter((r) => r.live)).toHaveLength(1);
  });

  it("renders the card's model name and every model, closed by default", () => {
    const html = renderToStaticMarkup(createElement(ModelComparison, { model: "stacked-lr-category@0.5" }));
    expect(html).toContain("stacked-lr-category@0.5");
    for (const r of MODEL_RESULTS) expect(html).toContain(r.name.replace("+", "+"));
    expect(html).not.toMatch(/<details[^>]* open/);
  });
});
