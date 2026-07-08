"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Outlet } from "@/lib/types";
import { PageLoader } from "@/components/ui/spinner";

// Which outlet is the user working in right now?
//
// Most shops have one outlet and never see any of this — the single
// outlet is selected automatically and no switcher is shown. When a
// tenant has multiple outlets (like the demo customer), a switcher
// appears in the navigation and every screen scopes to the choice.

type OutletContextValue = {
  tenantId: string;
  outlet: Outlet;          // currently selected outlet
  outlets: Outlet[];       // all outlets of this tenant
  switchOutlet: (id: string) => void;
};

const OutletContext = createContext<OutletContextValue | null>(null);

const STORAGE_KEY = "coffeetime.outlet_id";

export function OutletProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<OutletContextValue | null>(null);
  const [error, setError] = useState("");
  const [outletId, setOutletId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return; // middleware will redirect to /login
      const [me, outs] = await Promise.all([
        supabase.from("users").select("tenant_id, outlet_id").eq("id", auth.user.id).single(),
        supabase.from("outlets").select("*").order("created_at"),
      ]);
      if (me.error || outs.error || !outs.data?.length) {
        setError("Could not load your shop details. Please refresh, or log in again.");
        return;
      }
      const outlets = outs.data as Outlet[];
      // Prefer the last outlet used on this device, else the user's home outlet.
      const remembered = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const initial =
        outlets.find((o) => o.id === remembered)?.id ??
        outlets.find((o) => o.id === me.data.outlet_id)?.id ??
        outlets[0].id;
      setOutletId(initial);
      setValue({
        tenantId: me.data.tenant_id,
        outlets,
        outlet: outlets.find((o) => o.id === initial)!,
        switchOutlet: () => {},
      });
    }
    load();
  }, []);

  if (error) return <p className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!value || !outletId) return <PageLoader label="Loading your shop…" />;

  const ctx: OutletContextValue = {
    ...value,
    outlet: value.outlets.find((o) => o.id === outletId)!,
    switchOutlet: (id: string) => {
      if (!value.outlets.some((o) => o.id === id)) return;
      localStorage.setItem(STORAGE_KEY, id);
      setOutletId(id);
    },
  };

  return (
    <OutletContext.Provider value={ctx}>
      {/* key remounts every page when the outlet changes, so all data reloads */}
      <div key={outletId} className="contents">
        {children}
      </div>
    </OutletContext.Provider>
  );
}

export function useOutlet(): OutletContextValue {
  const ctx = useContext(OutletContext);
  if (!ctx) throw new Error("useOutlet must be used inside OutletProvider");
  return ctx;
}
