import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jax Acquisition CRM — Jacksonville / Duval County",
  description:
    "Map-based residential property acquisition CRM for Jacksonville, FL. Consumes the continuous Duval Oracle pipeline over MCP: saved criteria, proactive match notifications, and the full acquisition workflow.",
};

const NAV = [
  { href: "/", label: "Map" },
  { href: "/searches", label: "Saved searches" },
  { href: "/notifications", label: "Notifications" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/outreach", label: "Outreach" },
  { href: "/agent", label: "Ask" },
  { href: "/admin/pipeline", label: "Pipeline" },
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
              Jax Acquisition CRM <span>· Duval County, FL</span>
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
