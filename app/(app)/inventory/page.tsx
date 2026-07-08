"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Pencil, Plus } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDateTime, formatINR } from "@/lib/format";
import { UNITS, type Ingredient, type StockMovement } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type IngredientForm = {
  id?: string;
  name: string;
  unit: string;
  current_stock: string;
  low_stock_threshold: string;
  cost_per_unit: string;
};
const emptyForm: IngredientForm = { name: "", unit: "kg", current_stock: "0", low_stock_threshold: "0", cost_per_unit: "0" };

export default function InventoryPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [movements, setMovements] = useState<(StockMovement & { ingredients: { name: string; unit: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [editDialog, setEditDialog] = useState(false);
  const [form, setForm] = useState<IngredientForm>(emptyForm);

  const [moveDialog, setMoveDialog] = useState<null | { ing: Ingredient; direction: "in" | "out" }>(null);
  const [moveQty, setMoveQty] = useState("");
  const [moveType, setMoveType] = useState("usage");
  const [moveNote, setMoveNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    const supabase = getSupabase();
    const [ing, mov] = await Promise.all([
      supabase.from("ingredients").select("*").eq("is_active", true).order("name"),
      supabase
        .from("stock_movements")
        .select("*, ingredients(name, unit)")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    if (ing.error) {
      setError("Could not load stock. Please check your internet and refresh.");
    } else {
      setIngredients((ing.data as Ingredient[]) ?? []);
      setMovements((mov.data as typeof movements) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveIngredient(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      name: form.name.trim(),
      unit: form.unit,
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      cost_per_unit: Number(form.cost_per_unit) || 0,
    };
    let err;
    if (form.id) {
      ({ error: err } = await supabase.from("ingredients").update(payload).eq("id", form.id));
    } else {
      const { data: ctx } = await supabase.from("outlets").select("id, tenant_id").limit(1).single();
      ({ error: err } = await supabase.from("ingredients").insert({
        ...payload,
        current_stock: Number(form.current_stock) || 0,
        tenant_id: ctx?.tenant_id,
        outlet_id: ctx?.id,
      }));
    }
    setSaving(false);
    if (err) {
      setError("Could not save the ingredient. Please try again.");
    } else {
      setEditDialog(false);
      load();
    }
  }

  async function saveMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!moveDialog) return;
    setSaving(true);
    const type = moveDialog.direction === "in" ? "purchase" : moveType;
    const { error: err } = await getSupabase().rpc("adjust_stock", {
      p_ingredient_id: moveDialog.ing.id,
      p_type: type,
      p_quantity: Number(moveQty),
      p_note: moveNote.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError("Could not record the stock change. Please try again.");
    } else {
      setMoveDialog(null);
      setMoveQty("");
      setMoveNote("");
      load();
    }
  }

  const lowStock = ingredients.filter((i) => Number(i.current_stock) <= Number(i.low_stock_threshold));

  if (loading) return <PageLoader label="Loading stock…" />;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-coffee-900">Stock / Groceries</h1>
        <Button size="sm" onClick={() => { setForm(emptyForm); setEditDialog(true); }}>
          <Plus className="h-4 w-4" /> Ingredient
        </Button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {lowStock.length > 0 && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">
          <AlertTriangle className="h-4 w-4" />
          {lowStock.length} item{lowStock.length > 1 ? "s are" : " is"} low on stock: {lowStock.map((i) => i.name).join(", ")}
        </p>
      )}

      <div className="grid gap-2">
        {ingredients.map((ing) => {
          const low = Number(ing.current_stock) <= Number(ing.low_stock_threshold);
          return (
            <Card key={ing.id} className={cn(low && "border-red-300 bg-red-50")}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-medium">
                    {ing.name}
                    {low && <Badge variant="danger" className="ml-2">LOW</Badge>}
                  </p>
                  <p className={cn("text-sm", low ? "font-semibold text-red-700" : "text-gray-500")}>
                    {Number(ing.current_stock)} {ing.unit} in stock · {formatINR(ing.cost_per_unit)}/{ing.unit}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setMoveDialog({ ing, direction: "in" }); setMoveQty(""); setMoveNote(""); }}
                  >
                    <ArrowDownToLine className="h-4 w-4" /> In
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setMoveDialog({ ing, direction: "out" }); setMoveType("usage"); setMoveQty(""); setMoveNote(""); }}
                  >
                    <ArrowUpFromLine className="h-4 w-4" /> Out
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit ingredient"
                    onClick={() => {
                      setForm({
                        id: ing.id,
                        name: ing.name,
                        unit: ing.unit,
                        current_stock: String(ing.current_stock),
                        low_stock_threshold: String(ing.low_stock_threshold),
                        cost_per_unit: String(ing.cost_per_unit),
                      });
                      setEditDialog(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {ingredients.length === 0 && <p className="py-8 text-center text-gray-500">No ingredients yet. Tap “+ Ingredient”.</p>}
      </div>

      {/* Recent movements */}
      {movements.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 font-semibold text-coffee-900">Recent stock changes</h2>
          <div className="grid gap-1">
            {movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg bg-white p-2.5 text-sm">
                <div>
                  <span className="font-medium">{m.ingredients?.name}</span>
                  <span className="ml-2 text-xs uppercase text-gray-400">{m.type}</span>
                  {m.note && <p className="text-xs text-gray-500">{m.note}</p>}
                </div>
                <div className="text-right">
                  <span className={cn("font-semibold", Number(m.quantity) >= 0 ? "text-green-700" : "text-red-600")}>
                    {Number(m.quantity) >= 0 ? "+" : ""}
                    {Number(m.quantity)} {m.ingredients?.unit}
                  </span>
                  <p className="text-xs text-gray-400">{formatDateTime(m.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/edit ingredient */}
      <Dialog open={editDialog} onClose={() => setEditDialog(false)} title={form.id ? "Edit ingredient" : "New ingredient"}>
        <form onSubmit={saveIngredient} className="space-y-4">
          <div>
            <Label htmlFor="ing-name">Name</Label>
            <Input id="ing-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ing-unit">Unit</Label>
              <Select id="ing-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </div>
            {!form.id && (
              <div>
                <Label htmlFor="ing-stock">Opening stock</Label>
                <Input id="ing-stock" type="number" inputMode="decimal" min="0" step="any" value={form.current_stock} onChange={(e) => setForm({ ...form, current_stock: e.target.value })} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ing-low">Alert when below</Label>
              <Input id="ing-low" type="number" inputMode="decimal" min="0" step="any" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ing-cost">Cost per unit (₹)</Label>
              <Input id="ing-cost" type="number" inputMode="decimal" min="0" step="0.01" value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Save</Button>
        </form>
      </Dialog>

      {/* Stock in/out */}
      <Dialog
        open={!!moveDialog}
        onClose={() => setMoveDialog(null)}
        title={moveDialog ? `${moveDialog.direction === "in" ? "Stock in" : "Stock out"}: ${moveDialog.ing.name}` : ""}
      >
        <form onSubmit={saveMovement} className="space-y-4">
          {moveDialog?.direction === "out" && (
            <div>
              <Label htmlFor="move-type">Reason</Label>
              <Select id="move-type" value={moveType} onChange={(e) => setMoveType(e.target.value)}>
                <option value="usage">Used in kitchen</option>
                <option value="wastage">Wastage / spoiled</option>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="move-qty">Quantity ({moveDialog?.ing.unit})</Label>
            <Input id="move-qty" type="number" inputMode="decimal" min="0" step="any" value={moveQty} onChange={(e) => setMoveQty(e.target.value)} required autoFocus />
          </div>
          <div>
            <Label htmlFor="move-note">Note (optional)</Label>
            <Input id="move-note" value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder="e.g. bought from local store" />
          </div>
          <Button type="submit" className="w-full" disabled={saving || !moveQty}>
            {moveDialog?.direction === "in" ? "Add to stock" : "Remove from stock"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
