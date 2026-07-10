"use client";

import { useEffect } from "react";
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
  Users,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useAppUser, type AppUserStatus } from "@/lib/use-app-user";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, roles: ["owner", "manager"] },
  { href: "/pos", label: "Billing", icon: ReceiptIndianRupee, roles: ["owner", "manager", "cashier"] },
  { href: "/sales", label: "Sales", icon: ScrollText, roles: ["owner", "manager", "cashier"] },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed, roles: ["owner", "manager"] },
  { href: "/inventory", label: "Stock", icon: Boxes, roles: ["owner", "manager"] },
  { href: "/vendors", label: "Vendors", icon: Truck, roles: ["owner", "manager"] },
  { href: "/expenses", label: "Expenses", icon: Wallet, roles: ["owner", "manager"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["owner", "manager"] },
  { href: "/staff", label: "Staff", icon: Users, roles: ["owner"] },
];

// Route prefixes each role may open (NAV plus pages reached from
// within, like /purchases and /sales/[id]).
const ALLOWED_PREFIXES: Record<Role, string[]> = {
  owner: ["/dashboard", "/pos", "/sales", "/menu", "/inventory", "/vendors", "/purchases", "/expenses", "/reports", "/staff"],
  manager: ["/dashboard", "/pos", "/sales", "/menu", "/inventory", "/vendors", "/purchases", "/expenses", "/reports"],
  cashier: ["/pos", "/sales"],
};

const BLOCKED_MESSAGES: Partial<Record<AppUserStatus, { title: string; body: string }>> = {
  "no-invite": {
    title: "No shop linked to this email yet",
    body: "You're signed in, but this email hasn't been invited to any shop. Ask your shop owner (or your provider) to send an invite to this exact email, then log in again.",
  },
  "user-disabled": {
    title: "This account has been switched off",
    body: "Your access to the shop was turned off. Please talk to your shop owner.",
  },
  "tenant-disabled": {
    title: "This shop's account is not active",
    body: "The shop's subscription is currently switched off. Please contact your provider to reactivate it.",
  },
};

// Bottom tab bar on phones, left sidebar on tablets and up.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user } = useAppUser();

  const role = user?.role;
  const allowed = role ? ALLOWED_PREFIXES[role].some((p) => pathname.startsWith(p)) : false;

  useEffect(() => {
    if (status === "ready" && !allowed) {
      router.replace(role === "cashier" ? "/pos" : "/dashboard");
    }
  }, [status, allowed, role, router]);

  async function logout() {
    await getSupabase().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (status === "loading") return <PageLoader label="Loading…" />;

  const blocked = BLOCKED_MESSAGES[status];
  if (blocked) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-coffee-700 text-white">
              <Coffee className="h-7 w-7" />
            </div>
            <h1 className="text-lg font-semibold text-coffee-900">{blocked.title}</h1>
            <p className="text-sm text-gray-600">{blocked.body}</p>
            <Button variant="outline" className="w-full" onClick={logout}>
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Redirecting away from a page this role can't open.
  if (!allowed) return <PageLoader label="Loading…" />;

  const nav = NAV.filter((n) => role && n.roles.includes(role));

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
        <nav className="flex-1 space-y-1 p-2">
          {nav.map(({ href, label, icon: Icon }) => (
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

      {/* Main content */}
      <main className="min-w-0 flex-1 pb-20 md:ml-52 md:pb-4">{children}</main>

      {/* Bottom tab bar (phones) — first 5 destinations */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-coffee-200 bg-white md:hidden">
        {nav.slice(0, 5).map(({ href, label, icon: Icon }) => (
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
