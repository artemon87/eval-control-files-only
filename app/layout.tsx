import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PersistentAppShell } from "./components/persistent-app-shell";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EvalHub",
  description: "Monitor and compare end-to-end targets and versioned single-skill unit evaluations.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <PersistentAppShell>{children}</PersistentAppShell>
        </Providers>
      </body>
    </html>
  );
}
