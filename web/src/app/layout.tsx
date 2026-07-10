import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "Gaia DR3 slow-VGRF catalogue explorer",
  description:
    "Interactive visualisation and educational companion to the probabilistic " +
    "Gaia DR3 catalogue of stars with very low Galactic rest-frame speeds " +
    "(Humble 2026): browse the catalogue, follow the math, and integrate " +
    "orbits in the paper's galactic potential models, live in the browser.",
};

const NAV = [
  { href: "/viewer", label: "Orbit viewer" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/methods", label: "Methods" },
  { href: "/figures", label: "Figures" },
  { href: "/about", label: "About" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-borderc bg-surface/70 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-4 h-12 flex items-center gap-6">
            <Link href="/" className="flex items-baseline gap-2 shrink-0">
              <span className="font-semibold tracking-tight">
                slow-<span className="italic">V</span>
                <sub className="text-[0.65em]">GRF</sub>
              </span>
              <span className="text-xs text-muted hidden sm:inline">
                Gaia DR3 catalogue explorer
              </span>
            </Link>
            <nav className="flex gap-1 text-sm overflow-x-auto">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded text-muted hover:text-foreground hover:bg-surface-2 whitespace-nowrap"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
        <footer className="border-t border-borderc text-xs text-faint">
          <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap gap-x-6 gap-y-1">
            <span>
              Data: Gaia DR3 slow-V<sub>GRF</sub> catalogue v1.0.8-review
              (Humble 2026)
            </span>
            <a
              className="textlink"
              href="https://github.com/wodvik/gaia-slow-vgrf-catalogue"
            >
              catalogue repo
            </a>
            <a className="textlink" href="https://doi.org/10.5281/zenodo.20116134">
              Zenodo DOI
            </a>
            <span>
              Orbits are model quantities, not observables — see About for
              caveats.
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
