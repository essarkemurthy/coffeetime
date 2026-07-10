"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";

// Why an account may be signed in but still not allowed in:
//   no-invite       logged in, but no shop has invited this email
//   user-disabled   the shop owner switched this staff account off
//   tenant-disabled the whole shop was switched off by the platform
export type AppUserStatus =
  | "loading"
  | "ready"
  | "no-invite"
  | "user-disabled"
  | "tenant-disabled";

export function useAppUser() {
  const [status, setStatus] = useState<AppUserStatus>("loading");
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) return; // middleware sends them to /login

      const fetchRow = async () =>
        (
          await supabase
            .from("users")
            .select("id, tenant_id, outlet_id, name, role, is_active")
            .eq("id", authUser.id)
            .maybeSingle()
        ).data as AppUser | null;

      let row = await fetchRow();
      if (!row) {
        // Their invite may have been created after their first
        // login — claiming attaches them to the inviting shop.
        const { data: claimed } = await supabase.rpc("claim_invite");
        if (claimed) row = await fetchRow();
      }
      if (cancelled) return;
      if (!row) return setStatus("no-invite");
      if (!row.is_active) return setStatus("user-disabled");

      // RLS hides the tenant row when the shop is switched off.
      const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("id", row.tenant_id)
        .maybeSingle();
      if (cancelled) return;
      if (!tenant) return setStatus("tenant-disabled");

      setUser(row);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, user };
}
