"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useOutlet } from "@/lib/outlet";
import { formatDate, formatDateTime, formatINR, todayISO } from "@/lib/format";
import type { Sale } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

// List of bills for a chosen day (defaults to today).
export default function SalesPage() {
  const { outlet } = useOutlet();
  const [date, setDate] = useState(todayISO());
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError("");
    const { data, error: err } = await getSupabase()
      .from("sales")
      .select("*")
      .eq("outlet_id", outlet.id)
      .eq("sale_date", d)
      .order("bill_number", { ascending: false });
    if (err) {
      setError("Could not load sales. Please check your internet and refresh.");
    } else {
      setSales((data as Sale[]) ?? []);
    }
    setLoading(false);
  }, [outlet.id]);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const total = sales.reduce((s, x) => s + Number(x.total), 0);

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-coffee-900">Sales</h1>
        <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card className="mb-4">
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-gray-500">{formatDate(date)}</p>
            <p className="text-2xl font-bold text-coffee-900">{formatINR(total)}</p>
          </div>
          <Badge>{sales.length} bill{sales.length !== 1 ? "s" : ""}</Badge>
        </CardContent>
      </Card>

      {loading ? (
        <PageLoader label="Loading sales…" />
      ) : (
        <div className="grid gap-2">
          {sales.map((s) => (
            <Link key={s.id} href={`/sales/${s.id}`}>
              <Card className="transition-colors hover:bg-coffee-50">
                <CardContent className="flex items-center justify-between p-3">
                  <div>
                    <p className="font-medium">Bill #{s.bill_number}</p>
                    <p className="text-xs text-gray-500">{formatDateTime(s.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{s.payment_mode.toUpperCase()}</Badge>
                    <span className="font-semibold">{formatINR(s.total)}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {sales.length === 0 && <p className="py-8 text-center text-gray-500">No sales on this day.</p>}
        </div>
      )}
    </div>
  );
}
