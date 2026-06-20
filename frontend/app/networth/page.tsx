"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";

const ASSET_CATS: [string, string][] = [
  ["bank", "Bank accounts"], ["shares", "Shares"], ["crypto", "Crypto"],
  ["vehicle", "Vehicles"], ["property", "Property"], ["equipment", "Equipment"],
];
const LIABILITY_CATS: [string, string][] = [
  ["loan", "Loans"], ["credit_card", "Credit cards"], ["mortgage", "Mortgages"],
];

const EMPTY = { name: "", category: "bank", value: "" };

export default function NetWorth() {
  const { data: sum } = useSWR("/api/networth/summary", fetcher, { refreshInterval: 60_000 });
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const refresh = () => mutate("/api/networth/summary");

  function startEdit(it: any) {
    setEditId(it.id);
    setForm({ name: it.name, category: it.category, value: String((it.value_cents / 100).toFixed(2)) });
  }
  function reset() { setEditId(null); setForm(EMPTY); setErr(""); }

  async function save() {
    if (!form.name.trim()) return;
    setErr(""); setSaving(true);
    const body = JSON.stringify({
      name: form.name.trim(), category: form.category,
      value_cents: Math.round(parseFloat(form.value || "0") * 100),
    });
    try {
      if (editId) await api(`/api/networth/${editId}`, { method: "PUT", body });
      else await api("/api/networth", { method: "POST", body });
      refresh(); reset();
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setSaving(false); }
  }

  async function remove(id: number) {
    if (!confirm("Delete this item?")) return;
    await api(`/api/networth/${id}`, { method: "DELETE" });
    refresh();
    if (editId === id) reset();
  }

  const groups = sum?.groups || [];
  const assetGroups = groups.filter((g: any) => g.kind === "asset");
  const liabilityGroups = groups.filter((g: any) => g.kind === "liability");
  const nw = sum?.net_worth_cents ?? 0;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Net Worth</h1>
        <div className="text-sm text-muted">Assets minus liabilities. Bank balances update live from your accounts.</div>
      </div>

      {/* Headline */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <div className="stat-label">Total assets</div>
          <div className="stat-value text-good">{money(sum?.assets_cents ?? 0)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Total liabilities</div>
          <div className="stat-value text-bad">{money(sum?.liabilities_cents ?? 0)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Net worth</div>
          <div className={`stat-value ${nw >= 0 ? "text-accent" : "text-bad"}`}>{money(nw)}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
        {/* Add / edit form */}
        <div className="card">
          <div className="stat-label mb-3">{editId ? "Edit item" : "Add asset / liability"}</div>
          <div className="space-y-2">
            <input className="input" placeholder="Name * (e.g. Toyota Corolla)" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="input" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <optgroup label="Assets">
                {ASSET_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </optgroup>
              <optgroup label="Liabilities">
                {LIABILITY_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </optgroup>
            </select>
            <input className="input" placeholder="Value $ (e.g. 25000)" value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </div>
          {err && <div className="text-bad text-xs mt-2">{err}</div>}
          <div className="flex justify-end gap-2 mt-3">
            {editId && <button className="btn-ghost" onClick={reset}>Cancel</button>}
            <button className="btn" onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : editId ? "Save changes" : "Add item"}
            </button>
          </div>
        </div>

        {/* Breakdown */}
        <div className="space-y-6">
          <Section title="Assets" groups={assetGroups} tone="text-good"
            onEdit={startEdit} onRemove={remove} empty="No assets yet — add one on the left." />
          <Section title="Liabilities" groups={liabilityGroups} tone="text-bad"
            onEdit={startEdit} onRemove={remove} empty="No liabilities tracked." />
        </div>
      </div>
    </div>
  );
}

function Section({ title, groups, tone, onEdit, onRemove, empty }: any) {
  const total = groups.reduce((s: number, g: any) => s + g.total_cents, 0);
  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex justify-between items-center px-5 py-3 border-b border-border">
        <div className="font-medium">{title}</div>
        <div className={`font-semibold ${tone}`}>{money(total)}</div>
      </div>
      {groups.length === 0 ? (
        <div className="px-5 py-4 text-sm text-muted">{empty}</div>
      ) : groups.map((g: any) => (
        <div key={g.category} className="px-5 py-3 border-b border-border last:border-0">
          <div className="flex justify-between text-sm mb-1">
            <span className="stat-label">{g.label}</span>
            <span className="text-muted">{money(g.total_cents)}</span>
          </div>
          {g.items.map((it: any) => (
            <div key={it.id} className="flex justify-between items-center py-1 text-sm group">
              <span>{it.name}{it.id === -1 && <span className="text-xs text-muted ml-2">· live</span>}</span>
              <span className="flex items-center gap-3">
                <span>{money(it.value_cents)}</span>
                {it.id !== -1 && (
                  <span className="opacity-0 group-hover:opacity-100 transition flex gap-2">
                    <button className="text-accent text-xs" onClick={() => onEdit(it)}>edit</button>
                    <button className="text-bad text-xs" onClick={() => onRemove(it.id)}>delete</button>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
