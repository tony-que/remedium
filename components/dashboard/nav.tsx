"use client";

import { createContext, useCallback, useContext, useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { filtersToQuery, type Filters } from "@/lib/metrics/filters";

// Filters live in the URL. Every control calls update(), which pushes a new
// query string; the server page re-renders with fresh numbers. Controls show
// the new state at once (optimistically) while the current numbers stay in
// place at reduced opacity until the new ones arrive.

interface Nav {
  filters: Filters;
  pending: boolean;
  update: (patch: Partial<Filters>) => void;
  toggleCustomer: (id: string) => void;
  toggleSku: (sku: string) => void;
}

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav must be used inside <DashboardNav>");
  return nav;
}

export function DashboardNav({ filters, children }: { filters: Filters; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(filters);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...shown, ...patch };
      startTransition(() => {
        setShown(next);
        router.push(`/?${filtersToQuery(next)}`, { scroll: false });
      });
    },
    [shown, setShown, router],
  );
  const toggleCustomer = useCallback((id: string) => update({ customer: shown.customer === id ? null : id }), [shown.customer, update]);
  const toggleSku = useCallback((sku: string) => update({ sku: shown.sku === sku ? null : sku }), [shown.sku, update]);

  return (
    <NavContext.Provider value={{ filters: shown, pending, update, toggleCustomer, toggleSku }}>
      <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {children}
      </div>
    </NavContext.Provider>
  );
}
