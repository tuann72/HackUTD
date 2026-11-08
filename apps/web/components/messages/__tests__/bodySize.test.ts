import { describe, expect, it } from "vitest";
import { bodySizeClass } from "../MessageBody";

const of = (n: number) => "x".repeat(n);

describe("bodySizeClass", () => {
  it("makes short messages larger and long ones smaller", () => {
    expect(bodySizeClass(of(12))).toContain("text-2xl");
    expect(bodySizeClass(of(60))).toContain("text-xl");
    expect(bodySizeClass(of(140))).toContain("text-[17px]");
    expect(bodySizeClass(of(300))).toContain("text-[15px]");
    expect(bodySizeClass(of(600))).toContain("text-[13px]");
  });

  it("steps at the boundaries and ignores surrounding whitespace", () => {
    expect(bodySizeClass(of(30))).toContain("text-2xl");
    expect(bodySizeClass(of(31))).toContain("text-xl");
    expect(bodySizeClass(`   ${of(30)}\n\n`)).toContain("text-2xl");
  });
});
