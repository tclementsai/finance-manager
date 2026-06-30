"use client";
import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher, api, money } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";

const PLATFORMS = ["Raiz", "Stake", "Pearler", "CommSec", "SelfWealth", "Vanguard", "Other"];
const METHODS = ["ETF", "Shares", "Managed Fund", "Index Fund", "Super", "Crypto", "Other"];

const refresh = () => globalMutate((k: any) => typeof k === "string" &&
  (k.startsWith("/api/investment") || k.startsWith("/api/networth")));

export default function Investments() {
  const { selected } = useEntity();
  const { data: holdings } = useSWR(withEntity("/api/holdings", selected), fetcher);
  const { data: cgt } = useSWR(withEntity("/api/cgt-events", selected), fetcher);
  const { data: pack } = useSWR(withEntity("/api/dashboard/tax-pack", selected), fetcher);
  const { data: balances } = useSWR(withEntity("/api/investment-balances", selected), fetcher);
  const { data: entities } = useSWR("/api/entities", fetcher);

  const defaultEntityId = selected !== "all" ? selected : entities?.[0]?.id;

  const totalBalanceCents = (balances || []).reduce((s: number, b: any) => s + (b.balance_cents || 0), 0);

  // ── Raiz import ──
  const [raizImporting, setRaizImporting] = useState(false);
  const [raizResult, setRaizResult] = useState<any>(null);
  const [raizErr, setRaizErr] = useState("");

  async function handleRaizPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !defaultEntityId) return;
    setRaizImporting(true); setRaizResult(null); setRaizErr("");
    const formData = new FormData();
    formData.append("file", file);
    const token = typeof window !== "undefined" ? localStorage.getItem("ledger.token") : null;
    try {
      const res = await fetch(`/api/investment-balances/raiz-import?entity_id=${defaultEntityId}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      setRaizResult(await res.json());
      refresh();
    } catch (err: any) { setRaizErr(err.message || "Import failed"); }
    finally { setRaizImporting(false); if (e.target) e.target.value = ""; }
  }

  // ── Balance form ──
  const emptyForm = { entity_id: "", platform: "", method: "", balance: "" };
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function startEdit(b: any) {
    setEditId(b.id);
    setForm({
      entity_id: String(b.entity_id),
      platform: b.platform,
      method: b.method || "",
      balance: String((b.balance_cents / 100).toFixed(2)),
    });
    setErr("");
  }

  function resetForm() { setEditId(null); setForm(emptyForm); setErr(""); }

  async function saveBalance() {
    if (!form.platform.trim()) { setErr("Platform is required"); return; }
    setSaving(true); setErr("");
    const body = JSON.stringify({
      entity_id: Number(form.entity_id || defaultEntityId),
      platform: form.platform.trim(),
      method: form.method || null,
      balance_cents: Math.round(parseFloat(form.balance || "0") * 100),
    });
    try {
      if (editId) await api(`/api/investment-balances/${editId}`, { method: "PUT", body });
      else await api("/api/investment-balances", { method: "POST", body });
      refresh();
      resetForm();
    } catch (e: any) { setErr(e.message || "Error"); }
    finally { setSaving(false); }
  }

  async function deleteBalance(id: number) {
    if (!confirm("Remove this investment balance?")) return;
    await api(`/api/investment-balances/${id}`, { method: "DELETE" });
    refresh();
    if (editId === id) resetForm();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Investments & Tax Pack</h1>

      {/* Headline: total investment balance + breakdown per platform */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Total invested" value={money(totalBalanceCents)} tone="good"
          sub={`${(balances || []).length} platform${(balances || []).length !== 1 ? "s" : ""}`} />
        {(balances || []).slice(0, 3).map((b: any) => (
          <Stat key={b.id} label={b.platform} value={money(b.balance_cents)}
            sub={b.method || undefined} />
        ))}
      </div>

      {/* Tax pack stats */}
      {pack && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Capital gains (gross)" value={money(pack.capital_gains_gross_cents)} />
          <Stat label="Taxable cap gains" value={money(pack.capital_gains_taxable_cents)} sub="after 50% discount" />
          <Stat label="Est. taxable income" value={money(pack.estimated_taxable_income_cents)} />
          <Stat label="Est. balance owing" value={money(pack.estimated_balance_owing_cents)} tone="warn"
            sub="tax − PAYG withheld" />
        </div>
      )}

      {/* ── Raiz import ── */}
      <div className="card mb-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center text-xl shrink-0">🌱</div>
        <div className="flex-1">
          <div className="font-medium text-sm">Import Raiz Statement</div>
          <div className="text-xs text-muted mt-0.5">Upload your monthly Raiz PDF — balance and transactions are imported automatically</div>
          {raizResult && (
            <div className="text-xs text-good mt-1">
              Imported · Balance: {raizResult.balance_cents != null ? `$${(raizResult.balance_cents/100).toFixed(2)}` : "not found"}
              · {raizResult.transactions_imported} transactions
              {raizResult.holdings_found > 0 && ` · ${raizResult.holdings_found} holdings found`}
              {raizResult.period && ` · ${raizResult.period}`}
            </div>
          )}
          {raizErr && <div className="text-xs text-bad mt-1">{raizErr}</div>}
        </div>
        <label className={`btn shrink-0 cursor-pointer ${raizImporting ? "opacity-50 pointer-events-none" : ""}`}>
          {raizImporting ? "Importing…" : "Upload PDF"}
          <input type="file" accept="application/pdf" className="hidden" onChange={handleRaizPdf} disabled={raizImporting} />
        </label>
      </div>

      {/* ── Investment Balances ── */}
      <div className="grid lg:grid-cols-[360px_1fr] gap-6 mb-6 items-start">
        {/* Form */}
        <div className="card">
          <div className="stat-label mb-3">{editId ? "Edit balance" : "Add investment balance"}</div>
          <div className="space-y-2">
            <div>
              <div className="stat-label mb-1">Entity</div>
              <select className="input" value={form.entity_id || String(defaultEntityId || "")}
                onChange={(e) => setForm({ ...form, entity_id: e.target.value })}>
                {(entities || []).map((e: any) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="stat-label mb-1">Platform / provider</div>
              <input
                className="input" list="platform-list"
                placeholder="e.g. Raiz, Stake, CommSec"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              />
              <datalist id="platform-list">
                {PLATFORMS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <div className="stat-label mb-1">Investment method</div>
              <input
                className="input" list="method-list"
                placeholder="e.g. ETF, Shares, Managed Fund"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
              />
              <datalist id="method-list">
                {METHODS.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div>
              <div className="stat-label mb-1">Current balance ($)</div>
              <input
                className="input" type="number" min="0" step="0.01" placeholder="0.00"
                value={form.balance}
                onChange={(e) => setForm({ ...form, balance: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && saveBalance()}
              />
            </div>
          </div>
          {err && <div className="text-bad text-xs mt-2">{err}</div>}
          <div className="flex gap-2 justify-end mt-3">
            {editId && <button className="btn-ghost" onClick={resetForm}>Cancel</button>}
            <button className="btn" onClick={saveBalance} disabled={saving || !form.platform.trim()}>
              {saving ? "Saving…" : editId ? "Save changes" : "Add"}
            </button>
          </div>
        </div>

        {/* Balance list */}
        <div className="card p-0 overflow-x-auto">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="font-medium">Current balances</div>
            <div className="text-good font-semibold">{money(totalBalanceCents)}</div>
          </div>
          {(!balances || balances.length === 0) ? (
            <div className="px-5 py-6 text-sm text-muted">
              No balances yet — add one on the left.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Platform</th>
                  <th className="th">Method</th>
                  <th className="th">Entity</th>
                  <th className="th text-right">Balance</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {(balances || []).map((b: any) => {
                  const entityName = (entities || []).find((e: any) => e.id === b.entity_id)?.name ?? "";
                  return (
                    <tr key={b.id} className={editId === b.id ? "bg-accent/5" : ""}>
                      <td className="td font-medium">{b.platform}</td>
                      <td className="td text-muted">{b.method || "—"}</td>
                      <td className="td text-muted text-xs">{entityName}</td>
                      <td className="td text-right text-good font-medium">{money(b.balance_cents)}</td>
                      <td className="td text-right">
                        <div className="flex gap-2 justify-end">
                          <button className="text-accent text-xs hover:underline" onClick={() => startEdit(b)}>edit</button>
                          <button className="text-bad text-xs hover:underline" onClick={() => deleteBalance(b.id)}>×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Holdings & CGT */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card overflow-x-auto">
          <div className="stat-label mb-3">Holdings</div>
          <table className="w-full">
            <thead><tr>
              <th className="th">Symbol</th><th className="th">Platform</th>
              <th className="th text-right">Qty</th><th className="th text-right">Avg cost</th>
            </tr></thead>
            <tbody>
              {holdings?.map((h: any) => (
                <tr key={h.id}>
                  <td className="td font-medium">{h.symbol}</td>
                  <td className="td text-muted">{h.platform}</td>
                  <td className="td text-right">{h.qty}</td>
                  <td className="td text-right">{money(h.avg_cost_cents)}</td>
                </tr>
              ))}
              {holdings?.length === 0 && <tr><td className="td text-muted" colSpan={4}>No holdings.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto">
          <div className="stat-label mb-3">CGT events</div>
          <table className="w-full">
            <thead><tr>
              <th className="th">Date</th><th className="th">Symbol</th>
              <th className="th text-right">Gain</th><th className="th">Discount</th>
            </tr></thead>
            <tbody>
              {cgt?.map((e: any) => (
                <tr key={e.id}>
                  <td className="td">{e.date}</td>
                  <td className="td">{e.symbol}</td>
                  <td className={`td text-right ${e.gain_cents >= 0 ? "text-good" : "text-bad"}`}>{money(e.gain_cents)}</td>
                  <td className="td text-muted">{e.discounted ? "50%" : "—"}</td>
                </tr>
              ))}
              {cgt?.length === 0 && <tr><td className="td text-muted" colSpan={4}>No CGT events.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: any) {
  const t = tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "";
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${t}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}
