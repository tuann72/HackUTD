import { randomBytes } from "node:crypto";
import twilio from "twilio";

/**
 * Form fields of a Twilio inbound-SMS webhook, in the order of
 * contracts/fixtures/twilio-inbound-sms.sample.json.
 */
export const INBOUND_SMS_FIELDS = [
  "ToCountry",
  "ToState",
  "SmsMessageSid",
  "NumMedia",
  "ToCity",
  "FromZip",
  "SmsSid",
  "FromState",
  "SmsStatus",
  "FromCity",
  "Body",
  "FromCountry",
  "To",
  "ToZip",
  "NumSegments",
  "MessageSid",
  "AccountSid",
  "From",
  "ApiVersion",
] as const;

export type InboundSmsParams = Record<(typeof INBOUND_SMS_FIELDS)[number], string>;

/** `SM` + 32 random hex characters. Always crypto-random so reruns never collide with the gateway's dedupe. */
export function newMessageSid(): string {
  return "SM" + randomBytes(16).toString("hex");
}

/** Rough segment count: Twilio uses 160 chars per GSM-7 segment (153 when concatenated); this is close enough. */
export function numSegments(body: string): number {
  return Math.max(1, Math.ceil([...body].length / 160));
}

export interface InboundSmsInput {
  from: string;
  to: string;
  body: string;
  accountSid: string;
  messageSid?: string;
}

export function buildInboundSms(input: InboundSmsInput): InboundSmsParams {
  const sid = input.messageSid ?? newMessageSid();
  return {
    ToCountry: "US",
    ToState: "TX",
    SmsMessageSid: sid,
    NumMedia: "0",
    ToCity: "DALLAS",
    FromZip: "",
    SmsSid: sid,
    FromState: "",
    SmsStatus: "received",
    FromCity: "",
    Body: input.body,
    FromCountry: "US",
    To: input.to,
    ToZip: "",
    NumSegments: String(numSegments(input.body)),
    MessageSid: sid,
    AccountSid: input.accountSid,
    From: input.from,
    ApiVersion: "2010-04-01",
  };
}

/** X-Twilio-Signature (HMAC-SHA1 over the exact URL plus sorted params), via the official helper. */
export function signRequest(authToken: string, url: string, params: Record<string, string>): string {
  return twilio.getExpectedTwilioSignature(authToken, url, params);
}

export function encodeForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** `+15555550142` -> `***-***-0142` */
export function maskNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  return `***-***-${digits.slice(-4).padStart(4, "*")}`;
}
