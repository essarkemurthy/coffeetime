"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatINR } from "@/lib/format";
import type { Category, Item } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type CartLine = { item: Item; quantity: number };
const PAYMENT_MODES = ["cash", "upi", "card", "mixed"] as const;

export default function POSPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activeCat, setActiveCat] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [paymentMode, setPaymentMode] = useState<(typeof PAYMENT_MODES)[number]>("cash");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // bottom sheet on phones

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [cats, its] = await Promise.all([
      supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("items").select("*").eq("is_active", true).order("name"),
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

  const visibleItems = useMemo(() => items.filter((i) => i.category_id === activeCat), [items, activeCat]);

  const gross = cart.reduce((sum, l) => sum + l.item.price * l.quantity, 0);
  const discountNum = Math.min(Number(discount) || 0, gross);
  const total = gross - discountNum;
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

  function addToCart(item: Item) {
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) {
        return prev.map((l) => (l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { item, quantity: 1 }];
    });
  }

  function changeQty(itemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.item.id === itemId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  async function completeSale() {
    if (cart.length === 0) return;
    setPlacing(true);
    setError("");
    const { data, error: err } = await getSupabase().rpc("create_sale", {
      p_items: cart.map((l) => ({ item_id: l.item.id, quantity: l.quantity })),
      p_discount: discountNum,
      p_payment_mode: paymentMode,
    });
    setPlacing(false);
    if (err || !data?.sale_id) {
      setError("The sale could not be saved. Please try again.");
      return;
    }
    router.push(`/sales/${data.sale_id}?new=1`);
  }

  if (loading) return <PageLoader label="Loading billing screen…" />;

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 && <p className="py-8 text-center text-sm text-gray-500">Tap items to add them to the bill.</p>}
        {cart.map((l) => (
          <div key={l.item.id} className="flex items-center justify-between border-b border-coffee-100 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.item.name}</p>
              <p className="text-xs text-gray-500">{formatINR(l.item.price)} each</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => changeQty(l.item.id, -1)} aria-label="Less">
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-6 text-center font-semibold">{l.quantity}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => changeQty(l.item.id, 1)} aria-label="More">
                <Plus className="h-4 w-4" />
              </Button>
              <span className="w-20 text-right text-sm font-semibold">{formatINR(l.item.price * l.quantity)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t border-coffee-200 pt-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="discount" className="mb-0 whitespace-nowrap">Discount ₹</Label>
          <Input
            id="discount"
            type="number"
            inputMode="decimal"
            min="0"
            className="h-9"
            placeholder="0"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {PAYMENT_MODES.map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMode(m)}
              className={cn(
                "rounded-lg border py-2 text-xs font-semibold uppercase",
                paymentMode === m ? "border-coffee-700 bg-coffee-700 text-white" : "border-coffee-200 bg-white text-coffee-800"
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-lg font-bold text-coffee-900">
          <span>Total</span>
          <span>{formatINR(total)}</span>
        </div>
        {cart.length > 0 && (
          <button className="text-xs text-red-600 underline" onClick={() => { setCart([]); setDiscount(""); }}>
            <Trash2 className="mr-1 inline h-3 w-3" />Clear bill
          </button>
        )}
        <Button className="w-full" size="lg" variant="success" disabled={cart.length === 0 || placing} onClick={completeSale}>
          {placing ? "Saving…" : `Complete Sale · ${formatINR(total)}`}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col md:h-screen">
      {error && <p className="m-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto p-3 pb-1">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium",
              activeCat === c.id ? "bg-coffee-700 text-white" : "border border-coffee-200 bg-white text-coffee-800"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Item grid — big tappable buttons */}
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map((item) => {
            const inCart = cart.find((l) => l.item.id === item.id)?.quantity;
            return (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className={cn(
                  "relative flex min-h-[84px] flex-col items-start justify-between rounded-xl border bg-white p-3 text-left shadow-sm active:scale-[0.97]",
                  inCart ? "border-coffee-700 ring-1 ring-coffee-700" : "border-coffee-200"
                )}
              >
                <span className="text-sm font-semibold leading-tight text-coffee-900">{item.name}</span>
                <span className="text-sm text-gray-600">{formatINR(item.price)}</span>
                {inCart ? (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-coffee-700 text-xs font-bold text-white">
                    {inCart}
                  </span>
                ) : null}
              </button>
            );
          })}
          {visibleItems.length === 0 && (
            <p className="col-span-full py-8 text-center text-gray-500">No items in this category.</p>
          )}
        </div>

        {/* Cart — side panel on tablets/desktop */}
        <aside className="hidden w-80 flex-col border-l border-coffee-200 bg-white p-3 lg:flex">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-coffee-900">
            <ShoppingCart className="h-5 w-5" /> Current bill
          </h2>
          {cartPanel}
        </aside>
      </div>

      {/* Cart — floating button + bottom sheet on phones/small tablets */}
      <div className="lg:hidden">
        {!cartOpen && cartCount > 0 && (
          <button
            onClick={() => setCartOpen(true)}
            className="fixed inset-x-4 bottom-20 z-40 flex items-center justify-between rounded-xl bg-coffee-700 px-4 py-3 font-semibold text-white shadow-lg md:bottom-6"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> {cartCount} item{cartCount > 1 ? "s" : ""}
            </span>
            <span>{formatINR(total)} →</span>
          </button>
        )}
        {cartOpen && (
          <div className="fixed inset-0 z-50 flex items-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setCartOpen(false)} />
            <div className="relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-coffee-900">Current bill</h2>
                <button className="text-sm text-gray-500 underline" onClick={() => setCartOpen(false)}>Back to menu</button>
              </div>
              {cartPanel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
