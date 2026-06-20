"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api } from "@/lib/api";

const EMPTY = { name: "", email: "", phone: "", address: "" };

export default function Clients() {
  const { data: clients } = useSWR("/api/clients", fetcher);
  const { data: entities } = useSWR("/api/entities", fetcher);

  // Clients belong to a business entity (the one issuing invoices).
  const businesses = (entities || []).filter((e: any) => e.kind === "business");

  const [entityId, setEntityId] = useState<string>("");
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fromId = entityId || String(businesses[0]?.id ?? "");

  function startEdit(c: any) {
    setEditId(c.id);
    setEntityId(String(c.entity_id));
    setForm({ name: c.name || "", email: c.email || "", phone: c.phone || "", address: c.address || "" });
  }

  function reset() { setEditId(null); setForm(EMPTY); setErr(""); }

  async function save() {
    if (!form.name.trim() || !fromId) return;
    setErr(""); setSaving(true);
    try {
      if (editId) {
        await api(`/api/clients/${editId}`, {
          method: "PUT",
          body: JSON.stringify({ entity_id: Number(fromId), ...form }),
        });
      } else {
        await api("/api/clients", {
          method: "POST",
          body: JSON.stringify({ entity_id: Number(fromId), ...form }),
        });
      }
      await mutate("/api/clients");
      reset();
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setSaving(false); }
  }

  async function remove(id: number) {
    if (!confirm("Delete this client?")) return;
    await api(`/api/clients/${id}`, { method: "DELETE" });
    mutate("/api/clients");
    if (editId === id) reset();
  }

  const entityName = (id: number) => entities?.find((e: any) => e.id === id)?.name ?? "—";

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <div className="text-sm text-muted">People and businesses you invoice.</div>
      </div>

      {businesses.length === 0 ? (
        <div className="card text-sm text-muted">
          Add a business entity first (⚙ Manage businesses) — clients are billed from a business.
        </div>
      ) : (
        <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
          {/* Add / edit form */}
          <div className="card">
            <div className="stat-label mb-3">{editId ? "Edit client" : "Add client"}</div>
            <div className="space-y-2">
              <div>
                <div className="stat-label mb-1">Bill from (business)</div>
                <select className="input" value={fromId}
                  onChange={(e) => setEntityId(e.target.value)}>
                  {businesses.map((e: any) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <input className="input" placeholder="Client name *" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="input" placeholder="Email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="input" placeholder="Phone" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <textarea className="input" placeholder="Address" rows={2} value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            {err && <div className="text-bad text-xs mt-2">{err}</div>}
            <div className="flex justify-end gap-2 mt-3">
              {editId && <button className="btn-ghost" onClick={reset}>Cancel</button>}
              <button className="btn" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? "Saving…" : editId ? "Save changes" : "Add client"}
              </button>
            </div>
          </div>

          {/* List */}
          <div className="card p-0 overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className="th">Name</th><th className="th">Contact</th>
                <th className="th">Business</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {clients?.map((c: any) => (
                  <tr key={c.id} className="hover:bg-panel2/50">
                    <td className="td font-medium">{c.name}</td>
                    <td className="td text-muted text-sm">
                      {c.email || "—"}{c.phone ? ` · ${c.phone}` : ""}
                    </td>
                    <td className="td text-muted text-sm">{entityName(c.entity_id)}</td>
                    <td className="td text-right space-x-3 whitespace-nowrap">
                      <button className="text-accent text-xs" onClick={() => startEdit(c)}>edit</button>
                      <button className="text-bad text-xs" onClick={() => remove(c.id)}>delete</button>
                    </td>
                  </tr>
                ))}
                {clients?.length === 0 && (
                  <tr><td className="td text-muted" colSpan={4}>No clients yet — add your first on the left.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
