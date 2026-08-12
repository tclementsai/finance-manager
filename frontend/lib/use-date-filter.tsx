"use client";
import { useState } from "react";

export type DateRange = { start: string; end: string } | { start: null; end: null };

function today() {
  return new Date();
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fyRange(offset: number) {
  const now = today();
  const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const y = fyYear + offset;
  return { start: `${y}-07-01`, end: `${y + 1}-06-30` };
}

function monthRange() {
  const now = today();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${last}` };
}

function weekRange() {
  const now = today();
  const dow = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - dow);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: fmt(mon), end: fmt(sun) };
}

function quarterRange() {
  const now = today();
  const q = Math.floor(now.getMonth() / 3);
  const qStart = new Date(now.getFullYear(), q * 3, 1);
  const qEnd = new Date(now.getFullYear(), q * 3 + 3, 0);
  return { start: fmt(qStart), end: fmt(qEnd) };
}

const fyLabel = (offset: number) => {
  const now = today();
  const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const y = fyYear + offset;
  return `FY${String(y + 1).slice(2)}`;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Preset = "week" | "month" | "quarter" | "fy0" | "fy-1" | "all" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "fy0", label: "" },   // filled at render time
  { id: "fy-1", label: "" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function rangeFor(preset: Preset): DateRange {
  switch (preset) {
    case "week": return weekRange();
    case "month": return monthRange();
    case "quarter": return quarterRange();
    case "fy0": return fyRange(0);
    case "fy-1": return fyRange(-1);
    default: return { start: null, end: null };
  }
}

export function useDateFilter(defaultPreset: Preset = "month") {
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const range: DateRange =
    preset === "custom"
      ? (customStart && customEnd ? { start: customStart, end: customEnd } : { start: null, end: null })
      : rangeFor(preset);

  function buildQs(base: string) {
    const { start, end } = range;
    const sep = base.includes("?") ? "&" : "?";
    if (!start) return base;
    return `${base}${sep}start=${start}&end=${end}`;
  }

  // Caption under the presets, e.g. "from July 1". The year is included only
  // when the range starts in a different year, so "FY26" isn't mistaken for
  // this July rather than last.
  const rangeCaption = (() => {
    if (preset === "all") return "all time";
    if (!range.start) return "select a start and end date";
    const [y, m, d] = range.start.split("-").map(Number);
    const month = MONTHS[m - 1];
    return `from ${month} ${d}${y === today().getFullYear() ? "" : `, ${y}`}`;
  })();

  const DateFilter = (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg overflow-hidden border border-border text-xs">
        {PRESETS.map((p) => {
          const label =
            p.id === "fy0" ? fyLabel(0) :
            p.id === "fy-1" ? fyLabel(-1) :
            p.label;
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 transition-colors ${
                active
                  ? "bg-accent text-white font-medium"
                  : "text-muted hover:text-white hover:bg-surface-2"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input text-xs py-1 w-36"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <span className="text-muted text-xs">→</span>
          <input
            type="date"
            className="input text-xs py-1 w-36"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>
      )}
      </div>
      <div className="text-xs text-muted">{rangeCaption}</div>
    </div>
  );

  return { range, buildQs, DateFilter, preset };
}
