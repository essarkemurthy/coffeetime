"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, EyeOff, Eye } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatINR } from "@/lib/format";
import { GST_RATES, type Category, type Item } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type ItemForm = { id?: string; name: string; price: string; gst_percent: string; category_id: string };
const emptyItem = (categoryId: string): ItemForm => ({ name: "", price: "", gst_percent: "5", category_id: categoryId });

export default function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activeCat, setActiveCat] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // dialogs
  const [catDialog, setCatDialog] = useState(false);
  const [catForm, setCatForm] = useState<{ id?: string; name: string }>({ name: "" });
  const [itemDialog, setItemDialog] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem(""));
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const supabase = getSupabase();
    const [cats, its] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("items").select("*").order("name"),
    ]);
    if (cats.error || its.error) {
      setError("Could not load the menu. Please check your internet and refresh.");
    } else {
      setCategories((cats.data as Category[]) ?? []);
      setItems((its.data as Item[]) ?? []);
      setActiveCat((prev) => prev || (cats.data?.[0]?.id ?? ""));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (i) => i.category_id === activeCat && (showInactive || i.is_active)
      ),
    [items, activeCat, showInactive]
  );

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = getSupabase();
    let err;
    if (catForm.id) {
      ({ error: err } = await supabase.from("categories").update({ name: catForm.name.trim() }).eq("id", catForm.id));
    } else {
      const { data: ctx } = await supabase.from("outlets").select("id, tenant_id").limit(1).single();
      ({ error: err } = await supabase.from("categories").insert({
        tenant_id: ctx?.tenant_id,
        outlet_id: ctx?.id,
        name: catForm.name.trim(),
        sort_order: categories.length + 1,
      }));
    }
    setSaving(false);
    if (err) {
      setError("Could not save the category. Please try again.");
    } else {
      setCatDialog(false);
      setCatForm({ name: "" });
      load();
    }
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      name: itemForm.name.trim(),
      price: Number(itemForm.price),
      gst_percent: Number(itemForm.gst_percent),
      category_id: itemForm.category_id,
    };
    let err;
    if (itemForm.id) {
      ({ error: err } = await supabase.from("items").update(payload).eq("id", itemForm.id));
    } else {
      const { data: ctx } = await supabase.from("outlets").select("id, tenant_id").limit(1).single();
      ({ error: err } = await supabase.from("items").insert({ ...payload, tenant_id: ctx?.tenant_id, outlet_id: ctx?.id }));
    }
    setSaving(false);
    if (err) {
      setError("Could not save the item. Please try again.");
    } else {
      setItemDialog(false);
      load();
    }
  }

  // Bulk add: one item per line as "Name, Price" or "Name, Price, GST%"
  async function bulkAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const supabase = getSupabase();
    const { data: ctx } = await supabase.from("outlets").select("id, tenant_id").limit(1).single();
    const rows = bulkText
      .split("\n")
      .map((line) => line.split(",").map((s) => s.trim()))
      .filter((parts) => parts[0] && !isNaN(Number(parts[1])))
      .map((parts) => ({
        tenant_id: ctx?.tenant_id,
        outlet_id: ctx?.id,
        category_id: activeCat,
        name: parts[0],
        price: Number(parts[1]),
        gst_percent: GST_RATES.includes(Number(parts[2]) as (typeof GST_RATES)[number]) ? Number(parts[2]) : 5,
      }));
    if (rows.length === 0) {
      setError('No valid lines found. Use one item per line like: "Cappuccino, 120" or "Brownie, 90, 18"');
      setSaving(false);
      return;
    }
    const { error: err } = await supabase.from("items").insert(rows);
    setSaving(false);
    if (err) {
      setError("Could not add the items. Please try again.");
    } else {
      setBulkDialog(false);
      setBulkText("");
      load();
    }
  }

  async function toggleItemActive(item: Item) {
    // Soft delete: we never remove items, only hide them.
    await getSupabase().from("items").update({ is_active: !item.is_active }).eq("id", item.id);
    load();
  }

  if (loading) return <PageLoader label="Loading menu…" />;

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-coffee-900">Menu</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setCatForm({ name: "" }); setCatDialog(true); }}>
            <Plus className="h-4 w-4" /> Category
          </Button>
          <Button size="sm" onClick={() => { setItemForm(emptyItem(activeCat)); setItemDialog(true); }} disabled={!activeCat}>
            <Plus className="h-4 w-4" /> Item
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBulkDialog(true)} disabled={!activeCat}>
            Bulk add
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Category tabs */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            onDoubleClick={() => { setCatForm({ id: c.id, name: c.name }); setCatDialog(true); }}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium",
              activeCat === c.id ? "bg-coffee-700 text-white" : "bg-white text-coffee-800 border border-coffee-200"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-gray-500">Tip: double-tap a category to rename it.</p>

      {/* Items */}
      <div className="grid gap-2">
        {visibleItems.map((item) => (
          <Card key={item.id} className={cn(!item.is_active && "opacity-50")}>
            <CardContent className="flex items-center justify-between p-3">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-gray-500">
                  {formatINR(item.price)} · GST {item.gst_percent}%
                  {!item.is_active && <Badge variant="danger" className="ml-2">hidden</Badge>}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit item"
                  onClick={() => {
                    setItemForm({
                      id: item.id,
                      name: item.name,
                      price: String(item.price),
                      gst_percent: String(item.gst_percent),
                      category_id: item.category_id,
                    });
                    setItemDialog(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={item.is_active ? "Hide item" : "Show item"}
                  onClick={() => toggleItemActive(item)}
                >
                  {item.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {visibleItems.length === 0 && (
          <p className="py-8 text-center text-gray-500">No items here yet. Tap “+ Item” to add one.</p>
        )}
      </div>

      <button
        className="mt-4 text-sm text-coffee-700 underline"
        onClick={() => setShowInactive((v) => !v)}
      >
        {showInactive ? "Hide" : "Show"} hidden items
      </button>

      {/* Category dialog */}
      <Dialog open={catDialog} onClose={() => setCatDialog(false)} title={catForm.id ? "Rename category" : "New category"}>
        <form onSubmit={saveCategory} className="space-y-4">
          <div>
            <Label htmlFor="cat-name">Category name</Label>
            <Input id="cat-name" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} required autoFocus />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Save</Button>
        </form>
      </Dialog>

      {/* Item dialog */}
      <Dialog open={itemDialog} onClose={() => setItemDialog(false)} title={itemForm.id ? "Edit item" : "New item"}>
        <form onSubmit={saveItem} className="space-y-4">
          <div>
            <Label htmlFor="item-name">Item name</Label>
            <Input id="item-name" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="item-price">Price (₹, incl. GST)</Label>
              <Input
                id="item-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={itemForm.price}
                onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="item-gst">GST %</Label>
              <Select id="item-gst" value={itemForm.gst_percent} onChange={(e) => setItemForm({ ...itemForm, gst_percent: e.target.value })}>
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>{r}%</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="item-cat">Category</Label>
            <Select id="item-cat" value={itemForm.category_id} onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Save item</Button>
        </form>
      </Dialog>

      {/* Bulk add dialog */}
      <Dialog open={bulkDialog} onClose={() => setBulkDialog(false)} title="Bulk add items">
        <form onSubmit={bulkAdd} className="space-y-4">
          <p className="text-sm text-gray-600">
            One item per line: <strong>Name, Price</strong> or <strong>Name, Price, GST%</strong>.
            They will be added to the <strong>{categories.find((c) => c.id === activeCat)?.name}</strong> category.
          </p>
          <textarea
            className="h-40 w-full rounded-lg border border-coffee-300 p-3 text-sm"
            placeholder={"Cappuccino, 120\nEspresso, 90\nBrownie, 90, 18"}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={saving}>Add all</Button>
        </form>
      </Dialog>
    </div>
  );
}
