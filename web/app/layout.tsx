import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "lenis/dist/lenis.css";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-serif",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Elyrion — Only the worthy enter Elysium",
    template: "%s · Elyrion",
  },
  description: "Credit & reputation layer for AI agents on Elysium.",
};

export const viewport: Viewport = {
  themeColor: "#0B0A08",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <head>
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;filter:none!important;transform:none!important}[data-reveal] .reveal-grow{width:var(--w)!important}[data-reveal] .gate *{animation-play-state:running!important}`}</style>
        </noscript>
      </head>
      <body className="flex min-h-dvh flex-col bg-obsidian text-marble">
        {children}
      </body>
    </html>
  );
}
