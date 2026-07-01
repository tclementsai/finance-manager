"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ledger.token");
}

export default function Receipts() {
  const { data: receipts } = useSWR("/api/receipts", fetcher);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function deleteReceipt(id: number) {
    setDeleting(true);
    try {
      await api(`/api/receipts/${id}`, { method: "DELETE" });
      mutate("/api/receipts");
      if (viewing?.id === id) setViewing(null);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  function fileUrl(r: any) {
    const token = getToken();
    return `/api/receipts/${r.id}/file${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  const isPdf = (r: any) => r.file_path?.toLowerCase().endsWith(".pdf");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold">Receipts</h1>
          <p className="text-muted text-sm mt-0.5">
            Upload a receipt image or PDF — OCR extracts vendor, date and total automatically.
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
          <div key={r.id} className="card p-0 overflow-hidden flex flex-col">
            {/* Preview */}
            <button
              className="block w-full bg-panel2 relative overflow-hidden"
              style={{ height: 140 }}
              onClick={() => setViewing(r)}
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
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                <span className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">View</span>
              </div>
            </button>

            {/* Info */}
            <div className="p-4 flex-1 flex flex-col gap-1">
              <div className="font-medium text-sm truncate">{r.ocr_vendor || "Unknown vendor"}</div>
              <div className="text-xs text-muted">{r.ocr_date ? String(r.ocr_date) : "No date extracted"}</div>
              <div className="flex items-end justify-between mt-auto pt-2">
                <div>
                  <div className="text-lg font-semibold">{money(r.ocr_total_cents ?? 0)}</div>
                  {r.ocr_gst_cents > 0 && (
                    <div className="text-xs text-muted">GST {money(r.ocr_gst_cents)}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={fileUrl(r)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    Open ↗
                  </a>
                  {confirmDelete === r.id ? (
                    <>
                      <button
                        className="text-xs text-bad font-medium"
                        onClick={() => deleteReceipt(r.id)}
                        disabled={deleting}
                      >
                        {deleting ? "…" : "Confirm"}
                      </button>
                      <button className="text-xs text-muted" onClick={() => setConfirmDelete(null)}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-xs text-muted hover:text-bad transition-colors"
                      onClick={() => setConfirmDelete(r.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
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
            <div className="flex items-center justify-between px-4 py-3"
              style={{ background: "rgba(22,27,38,0.95)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div>
                <div className="font-medium text-sm">{viewing.ocr_vendor || "Receipt"}</div>
                <div className="text-xs text-muted">{viewing.ocr_date ? String(viewing.ocr_date) : ""}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">{money(viewing.ocr_total_cents ?? 0)}</span>
                <a href={fileUrl(viewing)} target="_blank" rel="noreferrer"
                  className="text-xs text-accent hover:underline">Open ↗</a>
                <button onClick={() => setViewing(null)} className="text-muted hover:text-white text-lg leading-none ml-1">✕</button>
              </div>
            </div>
            {isPdf(viewing) ? (
              <iframe
                src={fileUrl(viewing)}
                className="w-full"
                style={{ height: "75vh", background: "#fff" }}
                title="Receipt PDF"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(viewing)} alt="Receipt" className="w-full object-contain max-h-[75vh]"
                style={{ background: "#111" }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
