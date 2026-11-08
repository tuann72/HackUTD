import { describe, expect, it } from "vitest";
import type { Highlight } from "@/lib/messages";
import { FALLBACK_CATEGORY_CLASS, KNOWN_CATEGORIES, categoryClass, categoryLabel } from "../category";
import { defangText, findDefangRanges } from "../defang";
import { renderSegments, segmentHighlights } from "../highlight";
import { formatRelative, formatScore } from "../time";

const hl = (start: number, end: number, text = ""): Highlight => ({ start, end, text, weight: 0.5 });
const flat = (body: string, hs: Highlight[] | null, defang = true) =>
  renderSegments(body, hs, { defang })
    .map((s) => s.pieces.map((p) => p.text).join(""))
    .join("");

describe("segmentHighlights", () => {
  const body = "Your account is locked. Verify now";

  it("splits on valid spans and covers the whole body", () => {
    const segs = segmentHighlights(body, [hl(16, 22), hl(24, 30)]);
    expect(segs.map((s) => [s.text, !!s.highlight])).toEqual([
      ["Your account is ", false],
      ["locked", true],
      [". ", false],
      ["Verify", true],
      [" now", false],
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(body);
  });

  it("trims overlapping spans so no character repeats (earlier span wins)", () => {
    const segs = segmentHighlights(body, [hl(20, 30), hl(16, 22), hl(17, 19)]);
    expect(segs.map((s) => s.text).join("")).toBe(body);
    expect(segs.filter((s) => s.highlight).map((s) => s.text)).toEqual(["locked", ". Verify"]);
  });

  it("clamps out-of-range spans and drops empty, reversed or non-numeric ones", () => {
    const bad = [
      hl(-5, 4),
      hl(30, 999),
      hl(10, 10),
      hl(12, 8),
      { start: NaN, end: 3, text: "", weight: 1 },
      { start: "1", end: "3" } as unknown as Highlight,
      null as unknown as Highlight,
    ];
    const segs = segmentHighlights(body, bad);
    expect(segs.map((s) => s.text).join("")).toBe(body);
    expect(segs.filter((s) => s.highlight).map((s) => s.text)).toEqual(["Your", " now"]);
  });

  it("handles null highlights and empty bodies", () => {
    expect(segmentHighlights(body, null)).toEqual([{ start: 0, end: body.length, text: body, highlight: null }]);
    expect(() => segmentHighlights("", [hl(0, 5)])).not.toThrow();
    expect(renderSegments("", [hl(0, 5)], { defang: true }).flatMap((s) => s.pieces)).toEqual([]);
  });
});

describe("defang", () => {
  it("defangs scheme links", () => {
    expect(defangText("https://bit.ly/x")).toBe("hxxps://bit[.]ly/x");
    expect(defangText("go to HTTP://evil.example.com now")).toBe("go to HXXP://evil[.]example[.]com now");
  });

  it("defangs www and bare domains, leaving sentence punctuation alone", () => {
    expect(defangText("www.example.com")).toBe("www[.]example[.]com");
    expect(defangText("Verify at bit.ly/acct-verify now.")).toBe("Verify at bit[.]ly/acct-verify now.");
    expect(defangText("See example.com.")).toBe("See example[.]com.");
  });

  it("defangs phone numbers", () => {
    expect(defangText("+1 (555) 555-0142")).toBe("[+]1 (555) 555[-]0142");
    expect(defangText("call 555.555.0142 today")).toBe("call 555[.]555[.]0142 today");
    expect(findDefangRanges("call 555.555.0142")).toEqual([{ start: 5, end: 17, kind: "phone" }]);
  });

  it("leaves ordinary text, money and versions alone", () => {
    for (const t of ["I need $800 in gift cards", "Dinner Sunday still on?", "Pay $8.50, v1.2", "e.g. Main St. Pharmacy"]) {
      expect(defangText(t)).toBe(t);
    }
  });
});

describe("highlights + defang", () => {
  it("highlight offsets refer to the original body, defang applies per segment", () => {
    const body = "Verify at https://bit.ly/x or call +1 (555) 555-0142";
    // "Verify" and "bit.ly" (a highlight cutting through the link)
    const hs = [hl(0, 6), hl(18, 24)];
    const segs = renderSegments(body, hs, { defang: true });
    expect(segs.filter((s) => s.highlight).map((s) => s.text)).toEqual(["Verify", "bit.ly"]);
    expect(segs.find((s) => s.text === "bit.ly")!.pieces).toEqual([{ text: "bit[.]ly", kind: "url" }]);
    expect(flat(body, hs)).toBe("Verify at hxxps://bit[.]ly/x or call [+]1 (555) 555[-]0142");
  });

  it("a highlight splitting the scheme still yields hxxp", () => {
    const body = "https://a.co";
    expect(flat(body, [hl(0, 2), hl(2, 5)])).toBe("hxxps://a[.]co");
  });

  it("without defang, text is unchanged", () => {
    const body = "Visit example.com";
    expect(flat(body, [hl(6, 13)], false)).toBe(body);
  });
});

describe("category", () => {
  it("gives every known category its own color and a fallback otherwise", () => {
    const classes = KNOWN_CATEGORIES.map(categoryClass);
    expect(new Set(classes).size).toBe(KNOWN_CATEGORIES.length);
    expect(classes).not.toContain(FALLBACK_CATEGORY_CLASS);
    expect(categoryClass("Something new")).toBe(FALLBACK_CATEGORY_CLASS);
    expect(categoryClass(null)).toBe(FALLBACK_CATEGORY_CLASS);
    expect(categoryClass("Imposter & Phishing")).toBe(categoryClass("Imposter & Phishing"));
    expect(categoryLabel(null)).toBe("Uncategorized");
  });
});

describe("time", () => {
  const now = Date.parse("2026-11-07T21:15:00.000Z");
  it("formats relative times", () => {
    expect(formatRelative("2026-11-07T21:14:58.000Z", now)).toBe("just now");
    expect(formatRelative("2026-11-07T21:14:48.000Z", now)).toBe("12s ago");
    expect(formatRelative("2026-11-07T21:12:00.000Z", now)).toBe("3m ago");
    expect(formatRelative("2026-11-07T19:00:00.000Z", now)).toBe("2h ago");
    expect(formatRelative("2026-11-04T21:15:00.000Z", now)).toBe("3d ago");
    expect(formatRelative("2026-11-07T21:20:00.000Z", now)).toBe("just now");
    expect(formatRelative("not a date", now)).toBe("");
  });
  it("formats scores as percentages", () => {
    expect(formatScore(0.954)).toBe("95%");
    expect(formatScore(0.04)).toBe("4%");
    expect(formatScore(1.2)).toBe("100%");
  });
});
