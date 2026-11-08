import type { Metadata } from "next";
import { Anton, Archivo, Geist, Geist_Mono, Space_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Condensed display face for headlines and counters (`font-display`).
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

// Body text: a sturdier sans than Arial (Tuan: "too thin, select thicker").
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

// Small uppercase labels (`font-label`): a bold mono instead of thin Courier New.
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "T-Guard",
  description: "Potential-scam interception for the victim number",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} ${archivo.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
