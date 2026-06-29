"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useEntity } from "@/lib/entity-context";
import { useAuth } from "@/lib/auth-context";

const links = [
  ["/", "Dashboard", "◈"],
  ["/transactions", "Transactions", "↕"],
  ["/pnl", "P&L", "📊"],
  ["/invoices", "Invoices", "🧾"],
  ["/investments", "Investments", "📈"],
  ["/networth", "Net Worth", "🏦"],
  ["/recurring", "Recurring", "↻"],
  ["/import", "Import CSV", "⬆"],
  ["/receipts", "Receipts", "📎"],
  ["/commitments", "Commitments", "📋"],
  ["/deductions", "Deductions", "✓"],
  ["/clients", "Clients", "👤"],
  ["/connections", "Connections", "⚡"],
];

// Links shown in the mobile bottom tab bar (most used)
const mobileTabLinks = ["/", "/transactions", "/pnl", "/investments", "/networth"];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { selected, setSelected } = useEntity();
  const { username, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const mobileTabs = links.filter(([href]) => mobileTabLinks.includes(href));

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-border bg-panel p-4 flex-col">
        <div className="px-3 py-2 mb-3">
          <div className="text-lg font-semibold">Ledger</div>
          <div className="text-xs text-muted">Finance Manager</div>
          {username && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-muted truncate">{username}</span>
              <button onClick={handleLogout} className="text-xs text-muted hover:text-bad ml-1 shrink-0">
                Sign out
              </button>
            </div>
          )}
        </div>

        <div className="px-1 mb-4">
          <div className="stat-label mb-1">Business</div>
          <select
            className="input"
            value={String(selected)}
            onChange={(e) => setSelected(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">All income</option>
            {entities?.map((e: any) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
          {links.map(([href, label]) => (
            <Link key={href} href={href}
              className={`nav-link ${path === href ? "nav-link-active" : ""}`}>
              {label}
            </Link>
          ))}
        </nav>

        <Link href="/businesses"
          className={`nav-link mt-2 ${path === "/businesses" ? "nav-link-active" : ""}`}>
          ⚙ Manage businesses
        </Link>
      </aside>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-panel border-t border-border flex items-stretch">
        {mobileTabs.map(([href, label, icon]) => (
          <Link key={href} href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
              path === href ? "text-accent" : "text-muted"
            }`}>
            <span className="text-base leading-none">{icon}</span>
            <span className="leading-none">{label}</span>
          </Link>
        ))}
        {/* "More" button opens full menu overlay */}
        <button
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
            menuOpen ? "text-accent" : "text-muted"
          }`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className="text-base leading-none">☰</span>
          <span className="leading-none">More</span>
        </button>
      </nav>

      {/* ── Mobile full-screen menu overlay ── */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-[#0b0d12]/95 backdrop-blur-sm flex flex-col p-6 pb-24 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-lg font-semibold">Ledger</div>
              {username && <div className="text-xs text-muted">{username}</div>}
            </div>
            <button onClick={() => setMenuOpen(false)} className="text-muted text-2xl leading-none">×</button>
          </div>

          {/* Entity selector */}
          <div className="mb-5">
            <div className="stat-label mb-1">Business</div>
            <select
              className="input"
              value={String(selected)}
              onChange={(e) => setSelected(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">All income</option>
              {entities?.map((e: any) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 flex-1">
            {links.map(([href, label, icon]) => (
              <Link key={href} href={href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                  path === href ? "bg-panel2 text-white border border-border" : "text-muted hover:text-white"
                }`}>
                <span className="text-lg w-6 text-center">{icon}</span>
                {label}
              </Link>
            ))}
            <Link href="/businesses" onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                path === "/businesses" ? "bg-panel2 text-white border border-border" : "text-muted hover:text-white"
              }`}>
              <span className="text-lg w-6 text-center">⚙</span>
              Manage businesses
            </Link>
          </div>

          <button onClick={() => { handleLogout(); setMenuOpen(false); }}
            className="mt-4 text-sm text-bad text-center py-2">
            Sign out
          </button>
        </div>
      )}
    </>
  );
}
