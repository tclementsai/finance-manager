"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useEntity } from "@/lib/entity-context";
import { useAuth } from "@/lib/auth-context";

const links = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/transactions", label: "Transactions", icon: "↕" },
  { href: "/pnl", label: "Profit & Loss", icon: "📊" },
  { href: "/invoices", label: "Invoices", icon: "🧾" },
  { href: "/investments", label: "Investments", icon: "📈" },
  { href: "/networth", label: "Net Worth", icon: "🏦" },
  { href: "/recurring", label: "Recurring", icon: "↻" },
  { href: "/deductions", label: "Deductions", icon: "✓" },
  { href: "/receipts", label: "Receipts", icon: "📎" },
  { href: "/import", label: "Import CSV", icon: "⬆" },
  { href: "/commitments", label: "Commitments", icon: "📋" },
  { href: "/clients", label: "Clients", icon: "👤" },
  { href: "/connections", label: "Connections", icon: "⚡" },
  { href: "/businesses", label: "Manage Businesses", icon: "⚙" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { selected, setSelected } = useEntity();
  const { username, logout } = useAuth();
  const [open, setOpen] = useState(false);

  // Close menu on route change
  useEffect(() => { setOpen(false); }, [path]);

  // Prevent body scroll when menu open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const currentPage = links.find(l => l.href === path);

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
          {links.map(({ href, label }) => (
            <Link key={href} href={href}
              className={`nav-link ${path === href ? "nav-link-active" : ""}`}>
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* ── Mobile top bar ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3"
        style={{
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          background: "rgba(11, 13, 18, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
        <div>
          <div className="text-base font-semibold leading-tight">Ledger</div>
          {currentPage && (
            <div className="text-xs text-muted leading-tight">{currentPage.label}</div>
          )}
        </div>

        {/* Hamburger button */}
        <button
          onClick={() => setOpen(!open)}
          className="flex flex-col justify-center items-center w-9 h-9 gap-1.5 rounded-lg transition-colors"
          style={{ background: open ? "rgba(91,140,255,0.15)" : "rgba(255,255,255,0.05)" }}
          aria-label="Menu"
        >
          <span className={`block h-0.5 bg-white rounded-full transition-all duration-300 ${open ? "w-5 rotate-45 translate-y-2" : "w-5"}`} />
          <span className={`block h-0.5 bg-white rounded-full transition-all duration-300 ${open ? "w-0 opacity-0" : "w-4"}`} />
          <span className={`block h-0.5 bg-white rounded-full transition-all duration-300 ${open ? "w-5 -rotate-45 -translate-y-2" : "w-5"}`} />
        </button>
      </header>

      {/* ── Mobile drawer overlay ── */}
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={() => setOpen(false)}
      />

      {/* Drawer panel */}
      <div
        className={`md:hidden fixed top-0 right-0 bottom-0 z-50 w-72 flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{
          background: "rgba(16, 20, 30, 0.97)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div className="text-base font-semibold">Ledger</div>
            {username && <div className="text-xs text-muted mt-0.5">{username}</div>}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            ✕
          </button>
        </div>

        {/* Entity selector */}
        <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="stat-label mb-1.5">View as</div>
          <select
            className="input text-sm"
            value={String(selected)}
            onChange={(e) => setSelected(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">All entities</option>
            {entities?.map((e: any) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {links.map(({ href, label, icon }) => {
            const active = path === href;
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm transition-all duration-150 ${
                  active
                    ? "text-white font-medium"
                    : "text-muted hover:text-white"
                }`}
                style={active ? {
                  background: "rgba(91,140,255,0.15)",
                  border: "1px solid rgba(91,140,255,0.25)",
                } : {
                  background: "transparent",
                  border: "1px solid transparent",
                }}
              >
                <span className="text-base w-6 text-center opacity-80">{icon}</span>
                <span>{label}</span>
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted hover:text-bad transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-base w-6 text-center">→</span>
            Sign out
          </button>
        </div>
      </div>

    </>
  );
}
