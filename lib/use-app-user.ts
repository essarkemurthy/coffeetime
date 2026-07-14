"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";

// Why an account may be signed in but still not allowed in:
//   no-invite       logged in, but no shop has invited this email
//   user-disabled   the shop owner switched this staff account off
//   tenant-disabled the whole shop was switched off by the platform
//   signed-out      no session (normally middleware redirects first)
//   not-configured  Supabase env vars are missing from this deploy
//   error           the database could not be reached
export type AppUserStatus =
  | "loading"
  | "ready"
  | "no-invite"
  | "user-disabled"
  | "tenant-disabled"
  | "signed-out"
  | "not-configured"
  | "error";

export function useAppUser() {
  const [status, setStatus] = useState<AppUserStatus>("loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ) {
        return setStatus("not-configured");
      }
      const supabase = getSupabase();
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!authUser) return setStatus("signed-out");

        const fetchRow = async () => {
          const { data, error } = await supabase
            .from("users")
            .select("id, tenant_id, outlet_id, name, role, is_active")
            .eq("id", authUser.id)
            .maybeSingle();
          if (error) throw error;
          return data as AppUser | null;
        };

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
        const { data: tenant, error: tenantErr } = await supabase
          .from("tenants")
          .select("id")
          .eq("id", row.tenant_id)
          .maybeSingle();
        if (tenantErr) throw tenantErr;
        if (cancelled) return;
        if (!tenant) return setStatus("tenant-disabled");

        setUser(row);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { status, user, retry };
}
