import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const metadata: Metadata = {
  title: "Dashboard · T-Guard",
  description: "Overall analytics for the messages T-Guard has checked",
  formatDetection: { telephone: false, email: false, address: false },
};

export default function DashboardPage() {
  return <DashboardView />;
}
