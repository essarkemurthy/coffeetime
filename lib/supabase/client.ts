"use client";

import { createBrowserClient } from "@supabase/ssr";

// One shared Supabase client for all browser code.
// The placeholder values keep local builds working before
// you paste your real keys into .env.local.
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key"
    );
  }
  return client;
}
