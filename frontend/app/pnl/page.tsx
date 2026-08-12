"use client";
import useSWR from "swr";
import { fetcher, money, moneyShort } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";
import { useDateFilter } from "@/lib/use-date-filter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

export default function PnL() {
  const { selected } = useEntity();
  const { buildQs, DateFilter } = useDateFilter("month");

  const url = buildQs(withEntity("/api/dashboard/pnl", selected));
  const { data } = useSWR(url, fetcher);

  if (!data) return <div className="text-muted text-sm">Loading…</div>;

  const {
    total_revenue_cents,
    total_expenses_cents,
    gross_profit_cents,
    drawings_cents,
    net_profit_cents,
    revenue_by_category,
    expenses_by_category,
    by_month,
  } = data;

  const profitable = net_profit_cents >= 0;

  const monthData = Object.entries(by_month as Record<string, { revenue: number; expenses: number }>)
    .map(([month, v]) => ({
      month: month.slice(5),
      Revenue: +(v.revenue / 100).toFixed(2),
      Expenses: +(v.expenses / 100).toFixed(2),
      Profit: +((v.revenue - v.expenses) / 100).toFixed(2),
    }));

  const revenueRows = Object.entries(revenue_by_category as Record<string, number>);
  const expenseRows = Object.entries(expenses_by_category as Record<string, number>);

  return (
    <div className="max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold">Profit & Loss</h1>
        {DateFilter}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Revenue" value={money(total_revenue_cents)} tone="good" />
        <StatCard label="Total Expenses" value={money(total_expenses_cents)} tone="bad" />
        <StatCard label="Gross Profit" value={money(gross_profit_cents)} tone={gross_profit_cents >= 0 ? "good" : "bad"} />
        <StatCard
          label="Net Profit"
          value={money(net_profit_cents)}
          tone={profitable ? "good" : "bad"}
          sub={drawings_cents > 0 ? `After ${money(drawings_cents)} drawings` : undefined}
        />
      </div>

      {/* Month chart */}
      {monthData.length > 0 && (
        <div className="card mb-6">
          <div className="stat-label mb-4">Monthly P&L</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
              <XAxis dataKey="month" tick={{ fill: "#8a93a6", fontSize: 11 }} />
              <YAxis tick={{ fill: "#8a93a6", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#161922", border: "1px solid #2a2d3a", borderRadius: 8 }}
                labelStyle={{ color: "#8a93a6" }}
                formatter={(v: any) => `$${Number(v).toFixed(2)}`}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: "#8a93a6" }} />
              <Bar dataKey="Revenue" fill="#3ecf8e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Expenses" fill="#ff5c5c" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Revenue & Expense breakdown side by side */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="stat-label mb-3">Revenue by category</div>
          {revenueRows.length === 0 ? (
            <div className="text-muted text-sm">No revenue recorded.</div>
          ) : (
            <table className="w-full">
              <tbody>
                {revenueRows.map(([cat, cents]) => (
                  <tr key={cat} className="border-b border-border/50 last:border-0">
                    <td className="py-2 text-sm">{cat}</td>
                    <td className="py-2 text-right font-medium text-good">{money(cents as number)}</td>
                    <td className="py-2 text-right text-xs text-muted w-14">
                      {total_revenue_cents > 0
                        ? `${Math.round((cents as number) / total_revenue_cents * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td className="py-2 font-semibold text-sm">Total</td>
                  <td className="py-2 text-right font-bold text-good">{money(total_revenue_cents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="card">
          <div className="stat-label mb-3">Expenses by category</div>
          {expenseRows.length === 0 ? (
            <div className="text-muted text-sm">No expenses recorded.</div>
          ) : (
            <table className="w-full">
              <tbody>
                {expenseRows.map(([cat, cents]) => (
                  <tr key={cat} className="border-b border-border/50 last:border-0">
                    <td className="py-2 text-sm">{cat}</td>
                    <td className="py-2 text-right font-medium text-bad">{money(cents as number)}</td>
                    <td className="py-2 text-right text-xs text-muted w-14">
                      {total_revenue_cents > 0
                        ? `${Math.round((cents as number) / total_revenue_cents * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td className="py-2 font-semibold text-sm">Total</td>
                  <td className="py-2 text-right font-bold text-bad">{money(total_expenses_cents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}

          {/* P&L summary at bottom */}
          <div className="mt-4 pt-3 border-t border-border space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Gross profit</span>
              <span className={gross_profit_cents >= 0 ? "text-good font-medium" : "text-bad font-medium"}>
                {money(gross_profit_cents)}
              </span>
            </div>
            {drawings_cents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">Owner drawings</span>
                <span className="text-warn">− {money(drawings_cents)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-1">
              <span>Net profit</span>
              <span className={profitable ? "text-good" : "text-bad"}>{money(net_profit_cents)}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted mt-4">
        Switch to a specific business entity in the sidebar to see that entity's P&L only.
        Transactions assigned to a business entity via the Transactions page are included here.
      </p>
    </div>
  );
}

function StatCard({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}
