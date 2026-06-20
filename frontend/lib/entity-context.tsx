"use client";
import { createContext, useContext, useEffect, useState } from "react";

type EntityCtx = {
  /** Selected business id, or "all" */
  selected: number | "all";
  setSelected: (v: number | "all") => void;
};

const Ctx = createContext<EntityCtx>({ selected: "all", setSelected: () => {} });

export function EntityProvider({ children }: { children: React.ReactNode }) {
  // Always default to "all income" on load. The selection still applies while
  // navigating within a session, but never persists a stuck business filter
  // that makes the dashboard/transactions look empty after invoicing.
  const [selected, setSelected] = useState<number | "all">("all");

  // Clear any previously-persisted selection from older builds so it can't
  // re-stick the filter on future loads.
  useEffect(() => {
    localStorage.removeItem("ledger.entity");
  }, []);

  return <Ctx.Provider value={{ selected, setSelected }}>{children}</Ctx.Provider>;
}

export const useEntity = () => useContext(Ctx);

/** Append ?entity_id= to an API path unless "all" is selected. */
export function withEntity(path: string, selected: number | "all") {
  if (selected === "all") return path;
  return path + (path.includes("?") ? "&" : "?") + `entity_id=${selected}`;
}
