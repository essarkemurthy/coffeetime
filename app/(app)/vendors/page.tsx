"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Phone, Plus, ReceiptText } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useOutlet } from "@/lib/outlet";
import { formatINR } from "@/lib/format";
import type { Vendor } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

type VendorForm = { id?: string; name: string; phone: string; gstin: string; notes: string };
const emptyForm: VendorForm = { name: "", phone: "", gstin: "", notes: "" };

// Vendor master + pending dues per vendor (computed from purchases/payments).
export default function VendorsPage() {
  const { tenantId, outlet } = useOutlet();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [dues, setDues] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<VendorForm>(emptyForm);

  const load = useCallback(async () => {
    setError("");
    const supabase = getSupabase();
    const [v, p, pay] = await Promise.all([
      supabase.from("vendors").select("*").eq("outlet_id", outlet.id).eq("is_active", true).order("name"),
      supabase.from("purchases").select("id, vendor_id, total_amount").eq("outlet_id", outlet.id).eq("is_active", true),
      supabase.from("purchase_payments").select("purchase_id, amount").eq("outlet_id", outlet.id),
    ]);
    if (v.error || p.error || pay.error) {
      setError("Could not load vendors. Please check your internet and refresh.");
      setLoading(false);
      return;
    }
    const paidByPurchase = new Map<string, number>();
    for (const row of pay.data ?? []) {
      paidByPurchase.set(row.purchase_id, (paidByPurchase.get(row.purchase_id) ?? 0) + Number(row.amount));
    }
    const dueByVendor = new Map<string, number>();
    for (const row of p.data ?? []) {
      const due = Number(row.total_amount) - (paidByPurchase.get(row.id) ?? 0);
      if (due > 0) dueByVendor.set(row.vendor_id, (dueByVendor.get(row.vendor_id) ?? 0) + due);
    }
    setVendors((v.data as Vendor[]) ?? []);
    setDues(dueByVendor);
    setLoading(false);
  }, [outlet.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveVendor(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      gstin: form.gstin.trim() || null,
      notes: form.notes.trim() || null,
    };
    let err;
    if (form.id) {
      ({ error: err } = await supabase.from("vendors").update(payload).eq("id", form.id));
    } else {
      ({ error: err } = await supabase.from("vendors").insert({ ...payload, tenant_id: tenantId, outlet_id: outlet.id }));
    }
    setSaving(false);
    if (err) {
      setError("Could not save the vendor. Please try again.");
    } else {
      setDialog(false);
      load();
    }
  }

  const totalDues = Array.from(dues.values()).reduce((s, d) => s + d, 0);

  if (loading) return <PageLoader label="Loading vendors…" />;

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-coffee-900">Vendors</h1>
        <div className="flex gap-2">
          <Link href="/purchases">
            <Button variant="secondary" size="sm">
              <ReceiptText className="h-4 w-4" /> Purchases
            </Button>
          </Link>
          <Button size="sm" onClick={() => { setForm(emptyForm); setDialog(true); }}>
            <Plus className="h-4 w-4" /> Vendor
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {totalDues > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="p-4">
            <p className="text-sm text-amber-800">Total pending to vendors</p>
            <p className="text-2xl font-bold text-amber-900">{formatINR(totalDues)}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2">
        {vendors.map((v) => {
          const due = dues.get(v.id) ?? 0;
          return (
            <Card key={v.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="font-medium">{v.name}</p>
                  <p className="text-sm text-gray-500">
                    {v.phone && (
                      <a href={`tel:${v.phone}`} className="mr-2 inline-flex items-center gap-1 text-coffee-700">
                        <Phone className="h-3 w-3" /> {v.phone}
                      </a>
                    )}
                    {v.gstin && <span className="text-xs">GSTIN: {v.gstin}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {due > 0 ? <Badge variant="warning">Due {formatINR(due)}</Badge> : <Badge variant="success">Clear</Badge>}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit vendor"
                    onClick={() => {
                      setForm({ id: v.id, name: v.name, phone: v.phone ?? "", gstin: v.gstin ?? "", notes: v.notes ?? "" });
                      setDialog(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {vendors.length === 0 && (
          <p className="py-8 text-center text-gray-500">No vendors yet. Tap “+ Vendor” to add your first supplier.</p>
        )}
      </div>

      <Dialog open={dialog} onClose={() => setDialog(false)} title={form.id ? "Edit vendor" : "New vendor"}>
        <form onSubmit={saveVendor} className="space-y-4">
          <div>
            <Label htmlFor="v-name">Vendor name</Label>
            <Input id="v-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="v-phone">Phone</Label>
              <Input id="v-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="v-gstin">GSTIN (optional)</Label>
              <Input id="v-gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="v-notes">Notes</Label>
            <Textarea id="v-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. milk supplier, delivers every morning" />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Save vendor</Button>
        </form>
      </Dialog>
    </div>
  );
}
