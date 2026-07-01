"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ledger.token");
}

function fileUrl(r: any) {
  const token = getToken();
  return `/api/receipts/${r.id}/file${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}
const isPdf = (r: any) => r.file_path?.toLowerCase().endsWith(".pdf");

function ReceiptCard({ r, onView }: { r: any; onView: (r: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vendor: r.ocr_vendor ?? "",
    date: r.ocr_date ? String(r.ocr_date) : "",
    total: r.ocr_total_cents ? (r.ocr_total_cents / 100).toFixed(2) : "",
    gst: r.ocr_gst_cents ? (r.ocr_gst_cents / 100).toFixed(2) : "",
  });

  async function save() {
    setSaving(true);
    try {
      await api(`/api/receipts/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ocr_vendor: form.vendor || null,
          ocr_date: form.date || null,
          ocr_total_cents: form.total || null,
          ocr_gst_cents: form.gst || null,
        }),
      });
      mutate("/api/receipts");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    setDeleting(true);
    try {
      await api(`/api/receipts/${r.id}`, { method: "DELETE" });
      mutate("/api/receipts");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="card p-0 overflow-hidden flex flex-col">
      {/* Preview thumbnail */}
      <button
        className="block w-full bg-panel2 relative overflow-hidden"
        style={{ height: 140 }}
        onClick={() => onView(r)}
        title="Click to view"
      >
        {isPdf(r) ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted">
            <span className="text-4xl">📄</span>
            <span className="text-xs">PDF receipt</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl(r)}
            alt="Receipt"
            className="w-full h-full object-cover"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = "none";
              el.parentElement!.innerHTML = '<div class="flex flex-col items-center justify-center h-full gap-2 text-muted"><span class="text-4xl">🖼</span><span class="text-xs">Preview unavailable</span></div>';
            }}
          />
        )}
        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
          <span className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">View</span>
        </div>
      </button>

      {/* Info / edit */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        {editing ? (
          <>
            <input className="input text-sm" placeholder="Vendor name" value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            <input className="input text-sm" placeholder="Date (YYYY-MM-DD)" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <div className="flex gap-2">
              <input className="input text-sm flex-1" placeholder="Total $" value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })} />
              <input className="input text-sm flex-1" placeholder="GST $" value={form.gst}
                onChange={(e) => setForm({ ...form, gst: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button className="text-xs text-muted" onClick={() => setEditing(false)}>cancel</button>
              <button className="btn text-xs py-1 px-3" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="font-medium text-sm truncate">{r.ocr_vendor || <span className="text-muted italic">No vendor</span>}</div>
            <div className="text-xs text-muted">{r.ocr_date ? String(r.ocr_date) : <span className="italic">No date</span>}</div>
            <div className="flex items-end justify-between mt-auto pt-1">
              <div>
                <div className={`text-lg font-semibold ${!r.ocr_total_cents ? "text-muted text-sm" : ""}`}>
                  {r.ocr_total_cents ? money(r.ocr_total_cents) : "No amount"}
                </div>
                {r.ocr_gst_cents > 0 && (
                  <div className="text-xs text-muted">GST {money(r.ocr_gst_cents)}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <a href={fileUrl(r)} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Open ↗</a>
                <button className="text-xs text-muted hover:text-accent transition-colors" onClick={() => setEditing(true)}>edit</button>
                {confirmDelete ? (
                  <>
                    <button className="text-xs text-bad font-medium" onClick={del} disabled={deleting}>
                      {deleting ? "…" : "confirm?"}
                    </button>
                    <button className="text-xs text-muted" onClick={() => setConfirmDelete(false)}>cancel</button>
                  </>
                ) : (
                  <button className="text-xs text-muted hover:text-bad transition-colors" onClick={() => setConfirmDelete(true)}>delete</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Receipts() {
  const { data: receipts } = useSWR("/api/receipts", fetcher);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", f);
    const token = getToken();
    await fetch("/api/receipts", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    setBusy(false);
    mutate("/api/receipts");
    if (e.target) e.target.value = "";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold">Receipts</h1>
          <p className="text-muted text-sm mt-0.5">
            Upload a receipt — tap <strong>edit</strong> on any card to fill in the details manually.
          </p>
        </div>
        <label className="btn cursor-pointer shrink-0">
          {busy ? "Processing…" : "Upload receipt"}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={upload} disabled={busy} />
        </label>
      </div>

      {receipts?.length === 0 && (
        <div className="card text-muted text-sm mt-6">No receipts yet — upload one above.</div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {receipts?.map((r: any) => (
          <ReceiptCard key={r.id} r={r} onView={setViewing} />
        ))}
      </div>

      {/* Lightbox viewer */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
          onClick={() => setViewing(null)}
        >
          <div
            className="relative max-w-2xl w-full max-h-[90vh] rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ background: "rgba(22,27,38,0.95)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div>
                <div className="font-medium text-sm">{viewing.ocr_vendor || "Receipt"}</div>
                <div className="text-xs text-muted">{viewing.ocr_date ? String(viewing.ocr_date) : ""}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">{viewing.ocr_total_cents ? money(viewing.ocr_total_cents) : ""}</span>
                <a href={fileUrl(viewing)} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Open ↗</a>
                <button onClick={() => setViewing(null)} className="text-muted hover:text-white text-lg leading-none ml-1">✕</button>
              </div>
            </div>
            {isPdf(viewing) ? (
              <iframe src={fileUrl(viewing)} className="w-full" style={{ height: "75vh", background: "#fff" }} title="Receipt PDF" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(viewing)} alt="Receipt" className="w-full object-contain max-h-[75vh]" style={{ background: "#111" }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
