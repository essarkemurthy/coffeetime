"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useOutlet } from "@/lib/outlet";
import { formatDate, formatINR, todayISO } from "@/lib/format";
import type { Purchase } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

type PurchaseRow = Purchase & { vendors: { name: string } | null; paid: number };

const STATUS_BADGE: Record<Purchase["status"], "success" | "warning" | "danger"> = {
  paid: "success",
  partial: "warning",
  pending: "danger",
};

// Purchase bills with paid/partial/pending status, sorted oldest-due first,
// plus a dialog to record payments against a bill.
export default function PurchasesPage() {
  const { outlet } = useOutlet();
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [payDialog, setPayDialog] = useState<PurchaseRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayISO());
  const [payMode, setPayMode] = useState("cash");

  const load = useCallback(async () => {
    setError("");
    const supabase = getSupabase();
    const [p, pay] = await Promise.all([
      supabase
        .from("purchases")
        .select("*, vendors(name)")
        .eq("outlet_id", outlet.id)
        .eq("is_active", true)
        .order("bill_date", { ascending: true }),
      supabase.from("purchase_payments").select("purchase_id, amount").eq("outlet_id", outlet.id),
    ]);
    if (p.error || pay.error) {
      setError("Could not load purchases. Please check your internet and refresh.");
      setLoading(false);
      return;
    }
    const paidBy = new Map<string, number>();
    for (const r of pay.data ?? []) {
      paidBy.set(r.purchase_id, (paidBy.get(r.purchase_id) ?? 0) + Number(r.amount));
    }
    const list = ((p.data as (Purchase & { vendors: { name: string } | null })[]) ?? []).map((r) => ({
      ...r,
      paid: paidBy.get(r.id) ?? 0,
    }));
    // Unpaid bills first (oldest due at the top), then settled ones (newest first).
    list.sort((a, b) => {
      const aDue = a.status !== "paid" ? 0 : 1;
      const bDue = b.status !== "paid" ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return aDue === 0
        ? a.bill_date.localeCompare(b.bill_date)
        : b.bill_date.localeCompare(a.bill_date);
    });
    setRows(list);
    setLoading(false);
  }, [outlet.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payDialog) return;
    setSaving(true);
    setError("");
    const { error: err } = await getSupabase().rpc("record_purchase_payment", {
      p_purchase_id: payDialog.id,
      p_amount: Number(payAmount),
      p_payment_date: payDate,
      p_mode: payMode,
    });
    setSaving(false);
    if (err) {
      setError(err.message.includes("exceeds") ? "That is more than the pending amount." : "Could not save the payment. Please try again.");
    } else {
      setPayDialog(null);
      load();
    }
  }

  if (loading) return <PageLoader label="Loading purchases…" />;

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/vendors" className="text-coffee-700"><ArrowLeft className="h-5 w-5" /></Link>
          <h1 className="text-xl font-bold text-coffee-900">Purchases</h1>
        </div>
        <Link href="/purchases/new">
          <Button size="sm"><Plus className="h-4 w-4" /> New purchase</Button>
        </Link>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-2">
        {rows.map((r) => {
          const due = Number(r.total_amount) - r.paid;
          return (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{r.vendors?.name ?? "Vendor"}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(r.bill_date)}
                      {r.bill_number && <> · Bill {r.bill_number}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatINR(r.total_amount)}</p>
                    <Badge variant={STATUS_BADGE[r.status]}>{r.status.toUpperCase()}</Badge>
                  </div>
                </div>
                {r.status !== "paid" && (
                  <div className="mt-2 flex items-center justify-between border-t border-coffee-100 pt-2">
                    <p className="text-sm text-red-700">Pending: <strong>{formatINR(due)}</strong></p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setPayDialog(r); setPayAmount(String(due)); setPayDate(todayISO()); }}
                    >
                      Record payment
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <p className="py-8 text-center text-gray-500">No purchases yet. Tap “New purchase” after buying from a vendor.</p>
        )}
      </div>

      <Dialog
        open={!!payDialog}
        onClose={() => setPayDialog(null)}
        title={payDialog ? `Pay ${payDialog.vendors?.name ?? "vendor"}` : ""}
      >
        <form onSubmit={recordPayment} className="space-y-4">
          <div>
            <Label htmlFor="pay-amount">Amount (₹)</Label>
            <Input id="pay-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-date">Date</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="pay-mode">Mode</Label>
              <Select id="pay-mode" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
              </Select>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Save payment</Button>
        </form>
      </Dialog>
    </div>
  );
}
