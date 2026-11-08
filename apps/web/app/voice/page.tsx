import type { Metadata } from "next";
import { VoiceCallsView } from "@/components/voice/VoiceCallsView";

export const metadata: Metadata = {
  title: "Voice call results | T-Gate",
  description: "After-call transcripts and experimental classifier results",
};

export default function VoicePage() {
  return <VoiceCallsView />;
}
