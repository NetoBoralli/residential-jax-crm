import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title:
    "Jax Acquisition CRM — Residential property acquisition, Duval County FL",
  description:
    "Map-based residential acquisition CRM for Jacksonville / Duval County, driven by the continuous Duval Oracle pipeline over MCP.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/properties", label: "Find properties" },
  { href: "/searches", label: "Saved criteria" },
  { href: "/notifications", label: "Alerts" },
  { href: "/opportunities", label: "Pipeline" },
  { href: "/agent", label: "Agent" },
  { href: "/integration", label: "Data source" },
  { href: "/demo", label: "Demo" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="shell masthead-inner">
            <Link href="/" className="brand" data-testid="brand">
              Jax Acquisition CRM <span>· Jacksonville / Duval County, FL</span>
            </Link>
            <nav className="nav">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main>
          <div className="shell">{children}</div>
        </main>
      </body>
    </html>
  );
}
