import type { Metadata } from "next";
import { MessagesView } from "@/components/messages/MessagesView";

export const metadata: Metadata = {
  description: "The scene and the inbox and blocked potential scams for the victim number",
  // Keep mobile browsers from turning numbers in scam text into tap-to-call links.
  formatDetection: { telephone: false, email: false, address: false },
};

// Server Component shell; all data comes from useMessages in the client view.
export default function MessagesPage() {
  return <MessagesView />;
}
