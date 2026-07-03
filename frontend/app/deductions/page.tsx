"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher, money } from "@/lib/api";
import { useDateFilter } from "@/lib/use-date-filter";

export default function Deductions() {
  const { buildQs, DateFilter } = useDateFilter("fy0");
  const { data: entities } = useSWR("/api/entities", fetcher);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);

  const qs = buildQs(selectedEntityId
    ? `/api/dashboard/deductions?entity_id=${selectedEntityId}`
    : "/api/dashboard/deductions");
  const { data } = useSWR(qs, fetcher);

  if (!data) return <div className="text-muted">Loading…</div>;
  const cats = Object.entries(data.by_category || {});
  const showEntityCol = selectedEntityId === null;

  const entityMap: Record<number, any> = {};
  for (const e of entities || []) entityMap[e.id] = e;

  function entityLabel(e: any) {
    if (e.kind === "personal") return "Personal";
    return e.name;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold">Deductions</h1>
        {DateFilter}
      </div>

      {/* Entity tabs */}
      {entities && entities.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          <button
            onClick={() => setSelectedEntityId(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              selectedEntityId === null
                ? "bg-accent text-white"
                : "bg-panel2 text-muted hover:text-white border border-border"
            }`}
          >
            All
          </button>
          {(entities || []).map((e: any) => (
            <button
              key={e.id}
              onClick={() => setSelectedEntityId(e.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                selectedEntityId === e.id
                  ? "bg-accent text-white"
                  : "bg-panel2 text-muted hover:text-white border border-border"
              }`}
            >
              {entityLabel(e)}
            </button>
          ))}
        </div>
      )}

      <div className="card mb-6">
        <div className="stat-label">
          Total deductible
          {selectedEntityId ? ` · ${entityLabel(entityMap[selectedEntityId])}` : ""}
        </div>
        <div className="stat-value text-good">{money(data.total_deductible_cents)}</div>
        <p className="text-xs text-muted mt-1">
          Claimable amounts already adjusted for business-use %.
        </p>
      </div>

      {cats.length === 0 && <div className="text-muted text-sm">No deductible expenses tagged yet.</div>}

      {cats.map(([cat, g]: any) => (
        <div key={cat} className="card mb-4">
          <div className="flex justify-between items-baseline mb-3">
            <div className="font-medium">{cat}</div>
            <div className="text-good font-semibold">{money(g.total_cents)}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Description</th>
                  {showEntityCol && <th className="th">Entity</th>}
                  <th className="th text-right">Amount</th>
                  <th className="th text-right">Use %</th>
                  <th className="th text-right">Claimable</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i: any, idx: number) => {
                  const entity = entityMap[i.entity_id];
                  return (
                    <tr key={idx}>
                      <td className="td">{i.date}</td>
                      <td className="td">{i.description}</td>
                      {showEntityCol && (
                        <td className="td">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-panel2 text-muted border border-border whitespace-nowrap">
                            {entity ? entityLabel(entity) : "—"}
                          </span>
                        </td>
                      )}
                      <td className="td text-right">{money(i.amount_cents)}</td>
                      <td className="td text-right text-muted">{i.business_use_pct}%</td>
                      <td className="td text-right text-good">{money(i.claimable_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
