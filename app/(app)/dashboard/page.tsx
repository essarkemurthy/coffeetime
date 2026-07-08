"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ReceiptIndianRupee, ScrollText, Truck } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatINR, todayISO } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

type Stats = {
  todayTotal: number;
  billCount: number;
  topItems: { name: string; qty: number; amount: number }[];
  lowStock: string[];
  vendorDues: number;
};

// Home screen: today at a glance + shortcuts.
export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const today = todayISO();
      const [sales, saleItems, ingredients, purchases, payments] = await Promise.all([
        supabase.from("sales").select("total").eq("sale_date", today).eq("is_active", true),
        supabase.from("sale_items").select("item_name, quantity, line_total, sales!inner(sale_date)").eq("sales.sale_date", today),
        supabase.from("ingredients").select("name, current_stock, low_stock_threshold").eq("is_active", true),
        supabase.from("purchases").select("id, total_amount").eq("is_active", true).neq("status", "paid"),
        supabase.from("purchase_payments").select("purchase_id, amount"),
      ]);
      if (sales.error || saleItems.error || ingredients.error || purchases.error) {
        setError("Could not load today's numbers. Please check your internet and refresh.");
        return;
      }

      // Top 5 selling items today
      const byItem = new Map<string, { qty: number; amount: number }>();
      for (const r of (saleItems.data as { item_name: string; quantity: number; line_total: number }[]) ?? []) {
        const e = byItem.get(r.item_name) ?? { qty: 0, amount: 0 };
        e.qty += Number(r.quantity);
        e.amount += Number(r.line_total);
        byItem.set(r.item_name, e);
      }
      const topItems = Array.from(byItem.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

      // Pending vendor dues
      const paidBy = new Map<string, number>();
      for (const r of payments.data ?? []) {
        paidBy.set(r.purchase_id, (paidBy.get(r.purchase_id) ?? 0) + Number(r.amount));
      }
      const vendorDues = (purchases.data ?? []).reduce(
        (s, p) => s + Math.max(0, Number(p.total_amount) - (paidBy.get(p.id) ?? 0)),
        0
      );

      setStats({
        todayTotal: (sales.data ?? []).reduce((s, x) => s + Number(x.total), 0),
        billCount: sales.data?.length ?? 0,
        topItems,
        lowStock: (ingredients.data ?? [])
          .filter((i) => Number(i.current_stock) <= Number(i.low_stock_threshold))
          .map((i) => i.name),
        vendorDues,
      });
    }
    load();
  }, []);

  if (error) return <p className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!stats) return <PageLoader label="Loading your shop…" />;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-coffee-900">Today</h1>
        <Link href="/pos">
          <Button size="lg" variant="success">
            <ReceiptIndianRupee className="h-5 w-5" /> New bill
          </Button>
        </Link>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Today&apos;s sales</p>
            <p className="text-2xl font-bold text-coffee-900">{formatINR(stats.todayTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Bills today</p>
            <p className="text-2xl font-bold text-coffee-900">{stats.billCount}</p>
          </CardContent>
        </Card>
        <Link href="/inventory">
          <Card className={stats.lowStock.length > 0 ? "border-red-300 bg-red-50" : ""}>
            <CardContent className="p-4">
              <p className="flex items-center gap-1 text-sm text-gray-500">
                Low stock {stats.lowStock.length > 0 && <AlertTriangle className="h-4 w-4 text-red-600" />}
              </p>
              <p className={`text-2xl font-bold ${stats.lowStock.length > 0 ? "text-red-700" : "text-coffee-900"}`}>
                {stats.lowStock.length}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/vendors">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Vendor dues</p>
              <p className="text-2xl font-bold text-coffee-900">{formatINR(stats.vendorDues)}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {stats.lowStock.length > 0 && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <strong>Running low:</strong> {stats.lowStock.join(", ")} —{" "}
          <Link href="/inventory" className="underline">restock now</Link>
        </p>
      )}

      {/* Top sellers */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-2 font-semibold text-coffee-900">Top 5 sellers today</p>
          {stats.topItems.length === 0 ? (
            <p className="text-sm text-gray-500">No sales yet today. Tap “New bill” to start.</p>
          ) : (
            <div className="space-y-2">
              {stats.topItems.map((t, i) => (
                <div key={t.name} className="flex items-center justify-between text-sm">
                  <span>
                    <Badge className="mr-2">{i + 1}</Badge>
                    {t.name} × {t.qty}
                  </span>
                  <span className="font-medium">{formatINR(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shortcuts to sections not on the phone tab bar */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        <Link href="/vendors">
          <Button variant="outline" className="w-full"><Truck className="h-4 w-4" /> Vendors</Button>
        </Link>
        <Link href="/expenses">
          <Button variant="outline" className="w-full">Expenses</Button>
        </Link>
        <Link href="/reports">
          <Button variant="outline" className="w-full">Reports</Button>
        </Link>
        <Link href="/sales">
          <Button variant="outline" className="w-full"><ScrollText className="h-4 w-4" /> All sales</Button>
        </Link>
      </div>
    </div>
  );
}
