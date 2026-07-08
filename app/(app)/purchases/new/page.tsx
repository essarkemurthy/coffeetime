"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatINR, todayISO } from "@/lib/format";
import type { Ingredient, Vendor } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

type Line = { ingredient_id: string; quantity: string; rate: string };

// New vendor purchase: pick vendor, add line items, optionally record
// what was paid right away. Stock updates automatically.
export default function NewPurchasePage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [lines, setLines] = useState<Line[]>([{ ingredient_id: "", quantity: "", rate: "" }]);
  const [paidAmount, setPaidAmount] = useState("");
  const [payMode, setPayMode] = useState("cash");

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const [v, ing] = await Promise.all([
        supabase.from("vendors").select("*").eq("is_active", true).order("name"),
        supabase.from("ingredients").select("*").eq("is_active", true).order("name"),
      ]);
      if (v.error || ing.error) {
        setError("Could not load vendors/ingredients. Please refresh.");
      } else {
        setVendors((v.data as Vendor[]) ?? []);
        setIngredients((ing.data as Ingredient[]) ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0),
    [lines]
  );

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // When an ingredient is picked, pre-fill its last known rate.
  function pickIngredient(i: number, id: string) {
    const ing = ingredients.find((x) => x.id === id);
    setLine(i, { ingredient_id: id, rate: ing && Number(ing.cost_per_unit) > 0 ? String(ing.cost_per_unit) : "" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const validLines = lines.filter((l) => l.ingredient_id && Number(l.quantity) > 0 && Number(l.rate) >= 0);
    if (!vendorId) return setError("Please pick a vendor.");
    if (validLines.length === 0) return setError("Add at least one item with quantity and rate.");
    if (Number(paidAmount) > total) return setError("Paid amount cannot be more than the bill total.");

    setSaving(true);
    const { error: err } = await getSupabase().rpc("create_purchase", {
      p_vendor_id: vendorId,
      p_bill_number: billNumber.trim(),
      p_bill_date: billDate,
      p_items: validLines.map((l) => ({
        ingredient_id: l.ingredient_id,
        quantity: Number(l.quantity),
        rate: Number(l.rate),
      })),
      p_paid_amount: Number(paidAmount) || 0,
      p_payment_mode: payMode,
    });
    setSaving(false);
    if (err) {
      setError("Could not save the purchase. Please try again.");
    } else {
      router.push("/purchases");
    }
  }

  if (loading) return <PageLoader label="Loading…" />;

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/purchases" className="text-coffee-700"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-xl font-bold text-coffee-900">New purchase</h1>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form onSubmit={save} className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <Label htmlFor="p-vendor">Vendor</Label>
              <Select id="p-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
                <option value="">— pick a vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
              {vendors.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  No vendors yet — <Link href="/vendors" className="underline">add one first</Link>.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="p-bill">Vendor bill no. (optional)</Label>
                <Input id="p-bill" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="p-date">Bill date</Label>
                <Input id="p-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-medium text-coffee-900">Items bought</p>
            {lines.map((l, i) => {
              const unit = ingredients.find((x) => x.id === l.ingredient_id)?.unit;
              return (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    {i === 0 && <Label>Ingredient</Label>}
                    <Select value={l.ingredient_id} onChange={(e) => pickIngredient(i, e.target.value)}>
                      <option value="">— pick —</option>
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>{ing.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-24">
                    {i === 0 && <Label>Qty{unit ? ` (${unit})` : ""}</Label>}
                    <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </div>
                  <div className="w-24">
                    {i === 0 && <Label>Rate ₹</Label>}
                    <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Rate" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { ingredient_id: "", quantity: "", rate: "" }])}>
              <Plus className="h-4 w-4" /> Add line
            </Button>
            <p className="text-right text-lg font-bold text-coffee-900">Total: {formatINR(total)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-medium text-coffee-900">Payment (optional — leave 0 if paying later)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="p-paid">Paid now (₹)</Label>
                <Input id="p-paid" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="p-mode">Mode</Label>
                <Select id="p-mode" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" disabled={saving}>
          {saving ? "Saving…" : `Save purchase · ${formatINR(total)}`}
        </Button>
      </form>
    </div>
  );
}
