"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDate, formatINR, monthStartISO, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";
import { cn, downloadCSV } from "@/lib/utils";

type SaleRow = { sale_date: string; subtotal: number; gst_amount: number; discount: number; total: number; payment_mode: string };
type ItemRow = { item_name: string; quantity: number; line_total: number; sales: { sale_date: string } };

const TABS = ["Sales", "Items", "Payments", "P&L"] as const;

// Date-range reports with CSV export.
export default function ReportsPage() {
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [tab, setTab] = useState<(typeof TABS)[number]>("Sales");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [sales, setSales] = useState<SaleRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [expenseTotal, setExpenseTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = getSupabase();
    const [s, si, p, e] = await Promise.all([
      supabase.from("sales").select("sale_date, subtotal, gst_amount, discount, total, payment_mode")
        .eq("is_active", true).gte("sale_date", from).lte("sale_date", to),
      supabase.from("sale_items").select("item_name, quantity, line_total, sales!inner(sale_date, is_active)")
        .eq("sales.is_active", true).gte("sales.sale_date", from).lte("sales.sale_date", to),
      supabase.from("purchases").select("total_amount")
        .eq("is_active", true).gte("bill_date", from).lte("bill_date", to),
      supabase.from("expenses").select("amount")
        .eq("is_active", true).gte("expense_date", from).lte("expense_date", to),
    ]);
    if (s.error || si.error || p.error || e.error) {
      setError("Could not load the report. Please check your internet and try again.");
    } else {
      setSales((s.data as SaleRow[]) ?? []);
      setItems((si.data as unknown as ItemRow[]) ?? []);
      setPurchaseTotal((p.data ?? []).reduce((sum, x) => sum + Number(x.total_amount), 0));
      setExpenseTotal((e.data ?? []).reduce((sum, x) => sum + Number(x.amount), 0));
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Derived report tables ---

  const byDay = useMemo(() => {
    const m = new Map<string, { bills: number; subtotal: number; gst: number; discount: number; total: number }>();
    for (const s of sales) {
      const e = m.get(s.sale_date) ?? { bills: 0, subtotal: 0, gst: 0, discount: 0, total: 0 };
      e.bills += 1;
      e.subtotal += Number(s.subtotal);
      e.gst += Number(s.gst_amount);
      e.discount += Number(s.discount);
      e.total += Number(s.total);
      m.set(s.sale_date, e);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sales]);

  const byItem = useMemo(() => {
    const m = new Map<string, { qty: number; amount: number }>();
    for (const r of items) {
      const e = m.get(r.item_name) ?? { qty: 0, amount: 0 };
      e.qty += Number(r.quantity);
      e.amount += Number(r.line_total);
      m.set(r.item_name, e);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [items]);

  const byMode = useMemo(() => {
    const m = new Map<string, { bills: number; amount: number }>();
    for (const s of sales) {
      const e = m.get(s.payment_mode) ?? { bills: 0, amount: 0 };
      e.bills += 1;
      e.amount += Number(s.total);
      m.set(s.payment_mode, e);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].amount - a[1].amount);
  }, [sales]);

  const salesTotal = sales.reduce((s, x) => s + Number(x.total), 0);
  const profit = salesTotal - purchaseTotal - expenseTotal;

  function exportCurrent() {
    const range = `${from}_to_${to}`;
    if (tab === "Sales") {
      downloadCSV(`sales_${range}.csv`, byDay.map(([d, v]) => ({
        Date: formatDate(d), Bills: v.bills, "Subtotal (pre-GST)": v.subtotal.toFixed(2),
        GST: v.gst.toFixed(2), Discount: v.discount.toFixed(2), Total: v.total.toFixed(2),
      })));
    } else if (tab === "Items") {
      downloadCSV(`items_${range}.csv`, byItem.map((r) => ({
        Item: r.name, Quantity: r.qty, Amount: r.amount.toFixed(2),
      })));
    } else if (tab === "Payments") {
      downloadCSV(`payments_${range}.csv`, byMode.map(([mode, v]) => ({
        Mode: mode.toUpperCase(), Bills: v.bills, Amount: v.amount.toFixed(2),
      })));
    } else {
      downloadCSV(`pnl_${range}.csv`, [{
        From: formatDate(from), To: formatDate(to),
        Sales: salesTotal.toFixed(2), Purchases: purchaseTotal.toFixed(2),
        Expenses: expenseTotal.toFixed(2), Profit: profit.toFixed(2),
      }]);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-coffee-900">Reports</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="r-from">From</Label>
            <Input id="r-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="r-to">To</Label>
            <Input id="r-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={exportCurrent} disabled={loading}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium",
              tab === t ? "bg-coffee-700 text-white" : "border border-coffee-200 bg-white text-coffee-800"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <PageLoader label="Crunching numbers…" />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-4">
            {tab === "Sales" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-coffee-200 text-left text-gray-500">
                    <th className="py-2">Date</th>
                    <th className="py-2 text-right">Bills</th>
                    <th className="py-2 text-right">GST</th>
                    <th className="py-2 text-right">Discount</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map(([d, v]) => (
                    <tr key={d} className="border-b border-coffee-100">
                      <td className="py-2">{formatDate(d)}</td>
                      <td className="py-2 text-right">{v.bills}</td>
                      <td className="py-2 text-right">{formatINR(v.gst)}</td>
                      <td className="py-2 text-right">{formatINR(v.discount)}</td>
                      <td className="py-2 text-right font-semibold">{formatINR(v.total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 font-bold">Total</td>
                    <td className="py-2 text-right font-bold">{sales.length}</td>
                    <td className="py-2 text-right font-bold">{formatINR(sales.reduce((s, x) => s + Number(x.gst_amount), 0))}</td>
                    <td className="py-2 text-right font-bold">{formatINR(sales.reduce((s, x) => s + Number(x.discount), 0))}</td>
                    <td className="py-2 text-right font-bold">{formatINR(salesTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {tab === "Items" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-coffee-200 text-left text-gray-500">
                    <th className="py-2">Item</th>
                    <th className="py-2 text-right">Qty sold</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {byItem.map((r) => (
                    <tr key={r.name} className="border-b border-coffee-100">
                      <td className="py-2">{r.name}</td>
                      <td className="py-2 text-right">{r.qty}</td>
                      <td className="py-2 text-right font-semibold">{formatINR(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "Payments" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-coffee-200 text-left text-gray-500">
                    <th className="py-2">Payment mode</th>
                    <th className="py-2 text-right">Bills</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {byMode.map(([mode, v]) => (
                    <tr key={mode} className="border-b border-coffee-100">
                      <td className="py-2 uppercase">{mode}</td>
                      <td className="py-2 text-right">{v.bills}</td>
                      <td className="py-2 text-right font-semibold">{formatINR(v.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "P&L" && (
              <div className="space-y-3 text-sm">
                <p className="text-gray-500">
                  {formatDate(from)} to {formatDate(to)}
                </p>
                <div className="flex justify-between border-b border-coffee-100 py-2">
                  <span>Sales</span>
                  <span className="font-semibold text-green-700">+{formatINR(salesTotal)}</span>
                </div>
                <div className="flex justify-between border-b border-coffee-100 py-2">
                  <span>Vendor purchases</span>
                  <span className="font-semibold text-red-700">-{formatINR(purchaseTotal)}</span>
                </div>
                <div className="flex justify-between border-b border-coffee-100 py-2">
                  <span>Expenses (rent, salary, etc.)</span>
                  <span className="font-semibold text-red-700">-{formatINR(expenseTotal)}</span>
                </div>
                <div className="flex justify-between py-2 text-base font-bold">
                  <span>{profit >= 0 ? "Profit" : "Loss"}</span>
                  <span className={profit >= 0 ? "text-green-700" : "text-red-700"}>{formatINR(Math.abs(profit))}</span>
                </div>
                <p className="text-xs text-gray-400">
                  Note: this is a simple cash view — purchases are counted on the bill date, not when stock is used.
                </p>
              </div>
            )}

            {tab !== "P&L" && sales.length === 0 && (
              <p className="py-6 text-center text-gray-500">No sales in this date range.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
