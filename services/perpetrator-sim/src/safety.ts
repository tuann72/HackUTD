/** Fictional numbers only: +1 555 xxx xxxx (the 555 area code is not assigned to real subscribers). */
const FICTIONAL = /^\+1555\d{7}$/;

export function isFictionalNumber(number: string): boolean {
  return FICTIONAL.test(number);
}

export function assertSafeNumber(number: string, field: string, allowReal: boolean): void {
  if (allowReal) return;
  if (!isFictionalNumber(number)) {
    throw new Error(
      `${field} ${JSON.stringify(number)} is not a fictional +1555xxxxxxx number. ` +
        "Pass --allow-real-numbers to override.",
    );
  }
}

/** The simulator only ever talks to the gateway. Refuse anything that points at Photon itself. */
export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`GATEWAY_WEBHOOK_URL ${JSON.stringify(url)} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`GATEWAY_WEBHOOK_URL must be http(s), got ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "photon.codes" || host.endsWith(".photon.codes")) {
    throw new Error("GATEWAY_WEBHOOK_URL points at Photon. The simulator only sends to the gateway.");
  }
}
