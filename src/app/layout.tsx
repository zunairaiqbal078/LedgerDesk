import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "LedgerDesk",
  description: "Multi-tenant bank statement conversion and Canadian bookkeeping platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full`}>
      <body
        className="min-h-full font-[family-name:var(--font-sans)] antialiased text-slate-900"
        suppressHydrationWarning
      >
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
