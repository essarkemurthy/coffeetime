"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Coffee,
  LayoutDashboard,
  ReceiptIndianRupee,
  UtensilsCrossed,
  Boxes,
  Truck,
  Wallet,
  BarChart3,
  LogOut,
  ScrollText,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { OutletProvider, useOutlet } from "@/lib/outlet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/pos", label: "Billing", icon: ReceiptIndianRupee },
  { href: "/sales", label: "Sales", icon: ScrollText },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/inventory", label: "Stock", icon: Boxes },
  { href: "/vendors", label: "Vendors", icon: Truck },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

// Shown only when the tenant has more than one outlet.
function OutletSwitcher({ className }: { className?: string }) {
  const { outlet, outlets, switchOutlet } = useOutlet();
  if (outlets.length < 2) return null;
  return (
    <select
      aria-label="Outlet"
      className={cn(
        "w-full rounded-lg border border-coffee-300 bg-white px-2 py-2 text-sm font-medium text-coffee-900",
        className
      )}
      value={outlet.id}
      onChange={(e) => switchOutlet(e.target.value)}
    >
      {outlets.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

// Bottom tab bar on phones, left sidebar on tablets and up.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OutletProvider>
      <AppShell>{children}</AppShell>
    </OutletProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { outlets } = useOutlet();

  async function logout() {
    await getSupabase().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (md and up) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-52 flex-col border-r border-coffee-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-coffee-100 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-coffee-700 text-white">
            <Coffee className="h-5 w-5" />
          </div>
          <span className="font-semibold text-coffee-900">CoffeeTime</span>
        </div>
        <div className={cn("px-2 pt-2", outlets.length < 2 && "hidden")}>
          <OutletSwitcher />
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                pathname.startsWith(href)
                  ? "bg-coffee-700 text-white"
                  : "text-coffee-800 hover:bg-coffee-100"
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={logout}
          className="flex items-center gap-3 border-t border-coffee-100 p-4 text-sm text-gray-500 hover:text-red-600"
        >
          <LogOut className="h-5 w-5" /> Log out
        </button>
      </aside>

      {/* Main content (with an outlet bar on phones for multi-outlet tenants) */}
      <main className="min-w-0 flex-1 pb-20 md:ml-52 md:pb-4">
        {outlets.length > 1 && (
          <div className="border-b border-coffee-200 bg-white p-2 md:hidden">
            <OutletSwitcher />
          </div>
        )}
        {children}
      </main>

      {/* Bottom tab bar (phones) — first 5 destinations */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-coffee-200 bg-white md:hidden">
        {NAV.slice(0, 5).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
              pathname.startsWith(href) ? "text-coffee-700" : "text-gray-500"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
