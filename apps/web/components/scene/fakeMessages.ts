// Fake messages for the scene demo. Hand-written, no real numbers or links.
// The scene never decides anything itself: `potentialScam` and `action` stand
// in for the gateway's classification and deliver/block decision, which the
// live version will read from events.

export type Direction = "toVictim" | "toSender";

export interface FakeMessage {
  id: string;
  direction: Direction;
  text: string;
  /** Classifier flagged it (rendered red). */
  potentialScam: boolean;
  /** Gateway decision. Only messages to the victim can be blocked. */
  action: "delivered" | "blocked";
}

export const FAKE_MESSAGES: FakeMessage[] = [
  { id: "m01", direction: "toVictim", text: "Hey Grandma, are we still on for Sunday lunch?", potentialScam: false, action: "delivered" },
  { id: "m02", direction: "toSender", text: "Yes! I'll make the lasagna.", potentialScam: false, action: "delivered" },
  { id: "m03", direction: "toVictim", text: "URGENT: your bank account is locked. Verify now at secure-bank-help", potentialScam: true, action: "blocked" },
  { id: "m04", direction: "toVictim", text: "Your package is out for delivery today.", potentialScam: false, action: "delivered" },
  { id: "m05", direction: "toVictim", text: "Congratulations! You won a $1,000 gift card. Claim within 24h", potentialScam: true, action: "blocked" },
  { id: "m06", direction: "toVictim", text: "Reminder: dentist appointment Tue at 10am.", potentialScam: false, action: "delivered" },
  { id: "m07", direction: "toSender", text: "Thanks, I'll be there.", potentialScam: false, action: "delivered" },
  { id: "m08", direction: "toVictim", text: "Grandma it's me, I'm in jail, please send bail money in gift cards", potentialScam: true, action: "blocked" },
  { id: "m09", direction: "toVictim", text: "IRS notice: you owe back taxes. Pay today to avoid arrest", potentialScam: true, action: "blocked" },
  { id: "m10", direction: "toVictim", text: "Can you send me the pie recipe?", potentialScam: false, action: "delivered" },
  { id: "m11", direction: "toSender", text: "Sure, sending it tonight.", potentialScam: false, action: "delivered" },
  { id: "m12", direction: "toVictim", text: "Your Medicare card expires. Reply with your SSN to renew", potentialScam: true, action: "blocked" },
  { id: "m13", direction: "toVictim", text: "Pharmacy: your prescription is ready for pickup.", potentialScam: false, action: "delivered" },
  { id: "m14", direction: "toVictim", text: "Crypto opportunity: double your savings in 7 days, guaranteed", potentialScam: true, action: "blocked" },
  { id: "m15", direction: "toVictim", text: "Book club moved to Thursday this week.", potentialScam: false, action: "delivered" },
  { id: "m16", direction: "toSender", text: "Got it, see you then!", potentialScam: false, action: "delivered" },
  { id: "m17", direction: "toVictim", text: "Tech support: virus detected on your computer, call us now", potentialScam: true, action: "blocked" },
  { id: "m18", direction: "toVictim", text: "Happy birthday! Love you lots.", potentialScam: false, action: "delivered" },
  { id: "m19", direction: "toSender", text: "Aww thank you sweetie!", potentialScam: false, action: "delivered" },
  { id: "m20", direction: "toVictim", text: "Final notice: your car warranty is about to expire", potentialScam: true, action: "blocked" },
];
