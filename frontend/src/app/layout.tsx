import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

function trustedSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!configured) return new URL("http://localhost:3000");
  try { return new URL(configured.startsWith("http") ? configured : `https://${configured}`); }
  catch { return new URL("http://localhost:3000"); }
}

export const metadata: Metadata = {
  metadataBase: trustedSiteUrl(),
  title: { default: "Model Lab", template: "%s · Model Lab" },
  description: "A fast, personal workspace for ML models, experiments, runs, and metrics.",
  openGraph: {
    title: "Model Lab",
    description: "Track models, experiments, runs & metrics.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Model Lab — ML experiment tracking workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Model Lab",
    description: "Track models, experiments, runs & metrics.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable}`}><Providers>{children}</Providers></body>
    </html>
  );
}
