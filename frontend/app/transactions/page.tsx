"use client";
import React, { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";

const FREQS = ["weekly", "fortnightly", "monthly", "quarterly", "annual"];

async function uploadAndLinkReceipt(txId: number, file: File, onDone: () => void) {
  const formData = new FormData();
  formData.append("file", file);
  const token = typeof window !== "undefined" ? localStorage.getItem("ledger.token") : null;
  const res = await fetch("/api/receipts", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error("Receipt upload failed");
  const receipt = await res.json();
  await fetch(`/api/transactions/${txId}/receipt/${receipt.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  onDone();
}

const CATEGORY_COLORS = [
  "bg-[#5b8cff]/15 text-[#5b8cff]", "bg-[#3ecf8e]/15 text-[#3ecf8e]",
  "bg-[#f5a623]/15 text-[#f5a623]", "bg-[#c678ff]/15 text-[#c678ff]",
  "bg-[#ff5c5c]/15 text-[#ff5c5c]", "bg-[#38bdf8]/15 text-[#38bdf8]",
  "bg-[#fb923c]/15 text-[#fb923c]", "bg-[#a3e635]/15 text-[#a3e635]",
];

const refresh = () =>
  mutate((key) => typeof key === "string" &&
    (key.startsWith("/api/transactions") || key.startsWith("/api/dashboard") || key.startsWith("/api/recurring")));

export default function Transactions() {
  const { selected } = useEntity();
  const { data: txs, mutate: mutateTxs } = useSWR(withEntity("/api/transactions", selected), fetcher);
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { data: categories } = useSWR("/api/categories", fetcher);
  const [recurringOpen, setRecurringOpen] = useState<number | null>(null);
  const [entityOpen, setEntityOpen] = useState<number | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoResult, setAutoResult] = useState<any>(null);
  const [form, setForm] = useState<any>({
    direction: "out", amount: "", description: "", income_type: "",
    is_deductible: false, date: new Date().toISOString().slice(0, 10),
  });

  const entityName = (id: number) => entities?.find((e: any) => e.id === id)?.name ?? id;
  const defaultEntity = selected !== "all" ? selected : entities?.[0]?.id;

  // Stable color per category name
  const catColor = (name: string) =>
    CATEGORY_COLORS[Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % CATEGORY_COLORS.length];

  const expenseCategories = (categories || []).filter((c: any) => c.kind === "expense" || !c.kind);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        entity_id: Number(form.entity_id || defaultEntity),
        date: form.date,
        amount_cents: Math.round(parseFloat(form.amount) * 100),
        direction: form.direction,
        description: form.description,
        income_type: form.direction === "in" ? form.income_type || null : null,
        is_deductible: form.direction === "out" ? form.is_deductible : false,
      }),
    });
    setForm({ ...form, amount: "", description: "" });
    refresh();
  }

  async function del(id: number) {
    await api(`/api/transactions/${id}`, { method: "DELETE" });
    refresh();
  }

  async function setCategory(tx: any, categoryId: number | null) {
    if (categoryId === null) {
      // Clear on just this transaction
      await api(`/api/transactions/${tx.id}/category`, {
        method: "PATCH",
        body: JSON.stringify({ category_id: null }),
      });
    } else {
      // Apply to every transaction with the same description
      await api("/api/transactions/categorise", {
        method: "POST",
        body: JSON.stringify({ description: tx.description, category_id: categoryId }),
      });
    }
    mutateTxs();
    refresh();
  }

  async function runAutoCategorise() {
    setAutoRunning(true); setAutoResult(null);
    try {
      const res = await api("/api/categories/auto-categorise", { method: "POST" });
      setAutoResult(res);
      mutateTxs(); mutate("/api/categories"); refresh();
    } finally { setAutoRunning(false); }
  }

  async function createAndSetCategory(tx: any, name: string) {
    const created = await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), kind: "expense" }),
    });
    await mutate("/api/categories");
    await setCategory(tx, created.id);
  }

  async function toggleDeductible(id: number, current: boolean) {
    await api(`/api/transactions/${id}/deductible`, {
      method: "PATCH",
      body: JSON.stringify({ is_deductible: !current }),
    });
    refresh();
  }

  async function setEntity(id: number, entity_id: number) {
    await api(`/api/transactions/${id}/entity`, {
      method: "PATCH",
      body: JSON.stringify({ entity_id }),
    });
    setEntityOpen(null);
    refresh();
  }

  async function setRecurring(id: number, is_recurring: boolean, freq: string | null) {
    await api(`/api/transactions/${id}/recurring`, {
      method: "PATCH",
      body: JSON.stringify({ is_recurring, recurrence_freq: freq }),
    });
    setRecurringOpen(null);
    refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Transactions</h1>

      <form onSubmit={add} className="card mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
        <Field label="Entity">
          <select className="input" value={form.entity_id || defaultEntity || ""}
            onChange={(e) => setForm({ ...form, entity_id: e.target.value })}>
            {entities?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="input" value={form.direction}
            onChange={(e) => setForm({ ...form, direction: e.target.value })}>
            <option value="out">Expense</option>
            <option value="in">Income</option>
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className="input" value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Amount ($)">
          <input className="input" value={form.amount} placeholder="0.00"
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Description">
          <input className="input" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        {form.direction === "in" ? (
          <Field label="Income type">
            <select className="input" value={form.income_type}
              onChange={(e) => setForm({ ...form, income_type: e.target.value })}>
              <option value="">—</option>
              <option value="payroll">Payroll (PAYG)</option>
              <option value="business">Business income (gross)</option>
              <option value="drawing">Drawing (paid to me)</option>
              <option value="interest">Interest</option>
              <option value="dividend">Dividend</option>
              <option value="capital_gain">Capital gain</option>
            </select>
          </Field>
        ) : (
          <Field label="Deductible?">
            <label className="flex items-center gap-2 text-sm h-9">
              <input type="checkbox" checked={form.is_deductible}
                onChange={(e) => setForm({ ...form, is_deductible: e.target.checked })} />
              Tax deductible
            </label>
          </Field>
        )}
        <button className="btn h-9 col-span-2 md:col-span-1">Add</button>
      </form>

      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-muted">
          {autoResult && (
            <span className="text-good">
              Auto-categorised {autoResult.transactions_updated} transactions
              {autoResult.categories_created > 0 && ` · ${autoResult.categories_created} new categories`}
            </span>
          )}
        </div>
        <button className="btn-ghost text-sm" onClick={runAutoCategorise} disabled={autoRunning}>
          {autoRunning ? "Running…" : "✦ Auto-categorise all"}
        </button>
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full table-fixed min-w-[480px]">
          <colgroup>
            <col className="w-[80px]" />
            <col className="w-[80px]" />
            <col />
            <col className="w-[128px]" />
            <col className="w-[88px]" />
            <col className="w-[80px]" />
          </colgroup>
          <thead><tr>
            <th className="th overflow-hidden">Date</th>
            <th className="th overflow-hidden hidden lg:table-cell">Entity</th>
            <th className="th overflow-hidden">Description</th>
            <th className="th overflow-hidden">Category</th>
            <th className="th overflow-hidden text-right">Amount</th>
            <th className="th"></th>
          </tr></thead>
          <tbody>
            {txs?.map((t: any) => {
              const cat = (categories || []).find((c: any) => c.id === t.category_id);
              return (
                <React.Fragment key={t.id}>
                  <tr className={t.is_recurring ? "bg-accent/5" : ""}>
                    <td className="td text-xs tabular-nums">{t.date}</td>
                    <td className="td text-xs hidden lg:table-cell">
                      <button
                        className="text-muted hover:text-accent transition-colors truncate max-w-full block"
                        title="Click to reassign entity"
                        onClick={() => setEntityOpen(entityOpen === t.id ? null : t.id)}
                      >
                        {entityName(t.entity_id)} ▾
                      </button>
                    </td>
                    <td className="td max-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{t.description}</span>
                        {t.is_recurring && (
                          <span className="shrink-0 text-xs text-accent">↻</span>
                        )}
                        {t.is_deductible && (
                          <span className="shrink-0 text-xs text-good">✓</span>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      {t.direction === "out" ? (
                        cat ? (
                          <div className="flex items-center gap-1 group min-w-0">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full truncate min-w-0 ${catColor(cat.name)}`}>
                              {cat.name}
                            </span>
                            <button
                              className="shrink-0 text-muted opacity-0 group-hover:opacity-100 text-xs hover:text-bad transition-opacity"
                              title="Remove category"
                              onClick={() => setCategory(t, null)}
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <CategoryCombo
                            categories={expenseCategories}
                            onSelect={(id) => setCategory(t, id)}
                            onCreate={(name) => createAndSetCategory(t, name)}
                          />
                        )
                      ) : (
                        <span className="text-xs text-muted">{t.income_type || "income"}</span>
                      )}
                    </td>
                    <td className={`td text-right font-medium tabular-nums ${t.direction === "in" ? "text-good" : "text-bad"}`}>
                      {t.direction === "in" ? "+" : "−"}{money(t.amount_cents)}
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1.5">
                        {t.direction === "out" && (
                          <>
                            <button
                              title={t.is_deductible ? "Remove deductible flag" : "Mark as tax deductible"}
                              className={`text-xs px-1 py-0.5 rounded transition-colors ${
                                t.is_deductible
                                  ? "bg-good/15 text-good hover:bg-bad/15 hover:text-bad"
                                  : "text-muted hover:text-good hover:bg-good/10"
                              }`}
                              onClick={() => toggleDeductible(t.id, t.is_deductible)}
                            >
                              {t.is_deductible ? "✓" : "ded"}
                            </button>
                            {t.is_deductible && (
                              <ReceiptUpload
                                txId={t.id}
                                hasReceipt={!!t.receipt_id}
                                onDone={refresh}
                              />
                            )}
                            <button
                              className={`text-xs ${t.is_recurring ? "text-accent" : "text-muted hover:text-accent"}`}
                              onClick={() => setRecurringOpen(recurringOpen === t.id ? null : t.id)}
                            >
                              ↻
                            </button>
                          </>
                        )}
                        <button onClick={() => del(t.id)} className="text-muted hover:text-bad text-xs">×</button>
                      </div>
                    </td>
                  </tr>
                  {entityOpen === t.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 bg-surface-2">
                        <div className="flex items-center gap-3 text-sm flex-wrap">
                          <span className="text-muted">Move to:</span>
                          {(entities || []).map((e: any) => (
                            <button
                              key={e.id}
                              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                                e.id === t.entity_id
                                  ? "border-accent bg-accent/15 text-accent"
                                  : "border-border text-muted hover:border-accent hover:text-accent"
                              }`}
                              onClick={() => e.id !== t.entity_id && setEntity(t.id, e.id)}
                            >
                              {e.name}
                              {e.kind === "company" || e.kind === "sole_trader" ? " (business)" : " (personal)"}
                            </button>
                          ))}
                          <button className="text-muted text-xs" onClick={() => setEntityOpen(null)}>cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {recurringOpen === t.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 bg-surface-2">
                        <RecurringPicker tx={t} onSave={setRecurring} onClose={() => setRecurringOpen(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecurringPicker({ tx, onSave, onClose }: any) {
  const [freq, setFreq] = useState<string>(tx.recurrence_freq || "monthly");
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">Mark as recurring:</span>
      <select className="input text-sm w-36" value={freq} onChange={(e) => setFreq(e.target.value)}>
        {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <button className="btn text-sm py-1" onClick={() => onSave(tx.id, true, freq)}>Save</button>
      {tx.is_recurring && (
        <button className="btn-ghost text-sm py-1 text-bad" onClick={() => onSave(tx.id, false, null)}>
          Remove recurring
        </button>
      )}
      <button className="text-muted text-xs" onClick={onClose}>cancel</button>
    </div>
  );
}

function CategoryCombo({ categories, onSelect, onCreate }: {
  categories: any[];
  onSelect: (id: number) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = categories.filter((c: any) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  const exactMatch = categories.find(
    (c: any) => c.name.toLowerCase() === query.toLowerCase().trim()
  );

  function pick(id: number) { onSelect(id); setOpen(false); setQuery(""); }
  function create() { if (query.trim()) { onCreate(query.trim()); setOpen(false); setQuery(""); } }

  return (
    <div className="relative">
      <input
        className="input text-xs w-full"
        placeholder="+ Add category"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") exactMatch ? pick(exactMatch.id) : create();
          if (e.key === "Escape") { setOpen(false); setQuery(""); }
        }}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-48 bg-panel border border-border rounded-lg shadow-lg overflow-hidden">
          {filtered.map((c: any) => (
            <button
              key={c.id}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 text-white"
              onMouseDown={() => pick(c.id)}
            >
              {c.name}
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 text-accent border-t border-border"
              onMouseDown={create}
            >
              + Create "{query.trim()}"
            </button>
          )}
          {filtered.length === 0 && !query.trim() && (
            <div className="px-3 py-2 text-xs text-muted">Type to search or create</div>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptUpload({ txId, hasReceipt, onDone }: { txId: number; hasReceipt: boolean; onDone: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError("");
    try {
      await uploadAndLinkReceipt(txId, file, onDone);
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="relative" title={hasReceipt ? "Receipt attached" : "Upload receipt"}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        onChange={handleFile}
        disabled={uploading}
      />
      <span className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
        hasReceipt
          ? "bg-accent/15 text-accent"
          : "text-muted hover:text-accent hover:bg-accent/10"
      }`}>
        {uploading ? "…" : hasReceipt ? "📎" : "📎?"}
      </span>
      {error && <span className="text-bad text-xs ml-1">{error}</span>}
    </span>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <div className="stat-label mb-1">{label}</div>
      {children}
    </div>
  );
}
