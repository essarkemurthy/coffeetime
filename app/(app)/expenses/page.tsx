"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useOutlet } from "@/lib/outlet";
import { formatDate, formatINR, monthStartISO, todayISO } from "@/lib/format";
import { EXPENSE_CATEGORIES, type Expense } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

const LABELS: Record<string, string> = {
  rent: "Rent",
  salary: "Salary",
  electricity: "Electricity",
  maintenance: "Maintenance",
  misc: "Other",
};

// Shop expenses for the current month, with quick add.
export default function ExpensesPage() {
  const { tenantId, outlet } = useOutlet();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ category: "misc", amount: "", expense_date: todayISO(), note: "" });

  const load = useCallback(async () => {
    setError("");
    const { data, error: err } = await getSupabase()
      .from("expenses")
      .select("*")
      .eq("outlet_id", outlet.id)
      .eq("is_active", true)
      .gte("expense_date", monthStartISO())
      .order("expense_date", { ascending: false });
    if (err) {
      setError("Could not load expenses. Please check your internet and refresh.");
    } else {
      setExpenses((data as Expense[]) ?? []);
    }
    setLoading(false);
  }, [outlet.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveExpense(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = getSupabase();
    const { error: err } = await supabase.from("expenses").insert({
      tenant_id: tenantId,
      outlet_id: outlet.id,
      category: form.category,
      amount: Number(form.amount),
      expense_date: form.expense_date,
      note: form.note.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError("Could not save the expense. Please try again.");
    } else {
      setDialog(false);
      setForm({ category: "misc", amount: "", expense_date: todayISO(), note: "" });
      load();
    }
  }

  const total = expenses.reduce((s, x) => s + Number(x.amount), 0);

  if (loading) return <PageLoader label="Loading expenses…" />;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-coffee-900">Expenses</h1>
        <Button size="sm" onClick={() => setDialog(true)}>
          <Plus className="h-4 w-4" /> Expense
        </Button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="text-sm text-gray-500">This month so far</p>
          <p className="text-2xl font-bold text-coffee-900">{formatINR(total)}</p>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        {expenses.map((x) => (
          <Card key={x.id}>
            <CardContent className="flex items-center justify-between p-3">
              <div>
                <p className="font-medium">
                  {LABELS[x.category]} <Badge className="ml-1">{formatDate(x.expense_date)}</Badge>
                </p>
                {x.note && <p className="text-sm text-gray-500">{x.note}</p>}
              </div>
              <span className="font-semibold text-red-700">-{formatINR(x.amount)}</span>
            </CardContent>
          </Card>
        ))}
        {expenses.length === 0 && <p className="py-8 text-center text-gray-500">No expenses recorded this month.</p>}
      </div>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="New expense">
        <form onSubmit={saveExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="e-cat">Category</Label>
              <Select id="e-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{LABELS[c]}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="e-amount">Amount (₹)</Label>
              <Input id="e-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required autoFocus />
            </div>
          </div>
          <div>
            <Label htmlFor="e-date">Date</Label>
            <Input id="e-date" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="e-note">Note (optional)</Label>
            <Input id="e-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. June electricity bill" />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Save expense</Button>
        </form>
      </Dialog>
    </div>
  );
}
