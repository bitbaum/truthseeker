import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Space Grotesk — a sharp grotesk for the wordmark and headings. Reads as
// forensic / technical, far better suited to the concept than Arial.
const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  display: "swap",
});

// JetBrains Mono — the "evidence log" voice: labels, tags, metadata, the
// monospaced texture that signals structured analysis.
const monoAccent = JetBrains_Mono({
  variable: "--font-mono-accent",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "truthseeker — first-principles article analysis",
  description:
    "Paste an article URL. Get a forensic breakdown: claims tagged factual / normative / causal, a first-principles critique, named sources, author and publication biases, and what would change the assessment.",
  applicationName: "truthseeker",
  authors: [{ name: "truthseeker" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${monoAccent.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
