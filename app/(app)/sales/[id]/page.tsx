"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import type { Outlet, Sale, SaleItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const isNew = search.get("new") === "1";

  const [sale, setSale] = useState<Sale | null>(null);
  const [lines, setLines] = useState<SaleItem[]>([]);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      // The bill header shows the outlet that made the sale.
      const [s, li] = await Promise.all([
        supabase.from("sales").select("*, outlets(id, name, address, gstin, phone)").eq("id", id).single(),
        supabase.from("sale_items").select("*").eq("sale_id", id).order("item_name"),
      ]);
      if (s.error || li.error) {
        setError("Could not load this bill.");
      } else {
        const { outlets: saleOutlet, ...saleRow } = s.data as Sale & { outlets: Outlet | null };
        setSale(saleRow as Sale);
        setLines((li.data as SaleItem[]) ?? []);
        setOutlet(saleOutlet);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  // GST breakup grouped by rate (from the snapshotted values).
  const gstBreakup = useMemo(() => {
    const map = new Map<number, { taxable: number; gst: number }>();
    for (const l of lines) {
      const base = (l.line_total * 100) / (100 + Number(l.gst_percent));
      const entry = map.get(Number(l.gst_percent)) ?? { taxable: 0, gst: 0 };
      entry.taxable += base;
      entry.gst += l.line_total - base;
      map.set(Number(l.gst_percent), entry);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [lines]);

  function shareOnWhatsApp() {
    if (!sale) return;
    const text = [
      `*${outlet?.name ?? "Bill"}*`,
      `Bill #${sale.bill_number} · ${formatDate(sale.sale_date)}`,
      "",
      ...lines.map((l) => `${l.item_name} x${l.quantity} = ${formatINR(l.line_total)}`),
      "",
      sale.discount > 0 ? `Discount: -${formatINR(sale.discount)}` : "",
      `GST: ${formatINR(sale.gst_amount)}`,
      `*Total: ${formatINR(sale.total)}*`,
      `Paid by: ${sale.payment_mode.toUpperCase()}`,
      "",
      "Thank you! Visit again 😊",
    ]
      .filter(Boolean)
      .join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  if (loading) return <PageLoader label="Loading bill…" />;
  if (error || !sale) return <p className="p-6 text-red-600">{error || "Bill not found."}</p>;

  return (
    <div className="mx-auto max-w-md p-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href={isNew ? "/pos" : "/sales"} className="flex items-center gap-1 text-sm text-coffee-700">
          <ArrowLeft className="h-4 w-4" /> {isNew ? "New sale" : "All sales"}
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button variant="success" size="sm" onClick={shareOnWhatsApp}>
            <Share2 className="h-4 w-4" /> WhatsApp
          </Button>
        </div>
      </div>

      {isNew && (
        <p className="mb-3 rounded-lg bg-green-50 p-3 text-center text-sm font-medium text-green-800">
          ✅ Sale saved — Bill #{sale.bill_number}
        </p>
      )}

      {/* The bill — this block is what gets printed (72mm thermal layout). */}
      <Card>
        <CardContent className="p-0">
          <div id="print-bill" className="p-4">
            <div className="text-center">
              <p className="text-base font-bold">{outlet?.name ?? "My Coffee Shop"}</p>
              {outlet?.address && <p className="text-xs">{outlet.address}</p>}
              {outlet?.phone && <p className="text-xs">Ph: {outlet.phone}</p>}
              {outlet?.gstin && <p className="text-xs">GSTIN: {outlet.gstin}</p>}
            </div>
            <div className="my-2 border-t border-dashed border-gray-400" />
            <div className="flex justify-between text-xs">
              <span>Bill #{sale.bill_number}</span>
              <span>{formatDateTime(sale.created_at)}</span>
            </div>
            <div className="my-2 border-t border-dashed border-gray-400" />

            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th className="pb-1">Item</th>
                  <th className="pb-1 text-center">Qty</th>
                  <th className="pb-1 text-right">Rate</th>
                  <th className="pb-1 text-right">Amt</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-0.5">{l.item_name}</td>
                    <td className="py-0.5 text-center">{l.quantity}</td>
                    <td className="py-0.5 text-right">{Number(l.price).toFixed(2)}</td>
                    <td className="py-0.5 text-right">{Number(l.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="my-2 border-t border-dashed border-gray-400" />
            <div className="space-y-0.5 text-xs">
              <div className="flex justify-between">
                <span>Subtotal (before GST)</span>
                <span>{formatINR(sale.subtotal)}</span>
              </div>
              {gstBreakup.map(([rate, v]) =>
                rate > 0 ? (
                  <div key={rate} className="flex justify-between">
                    <span>GST {rate}% (CGST+SGST)</span>
                    <span>{formatINR(v.gst)}</span>
                  </div>
                ) : null
              )}
              {sale.discount > 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>-{formatINR(sale.discount)}</span>
                </div>
              )}
            </div>
            <div className="my-2 border-t border-dashed border-gray-400" />
            <div className="flex justify-between text-sm font-bold">
              <span>TOTAL</span>
              <span>{formatINR(sale.total)}</span>
            </div>
            <p className="mt-1 text-right text-xs">Paid by {sale.payment_mode.toUpperCase()}</p>
            <div className="my-2 border-t border-dashed border-gray-400" />
            <p className="text-center text-xs">Thank you! Visit again 😊</p>
          </div>
        </CardContent>
      </Card>

      {isNew && (
        <Link href="/pos">
          <Button className="mt-4 w-full" size="lg">Start next bill</Button>
        </Link>
      )}
    </div>
  );
}
