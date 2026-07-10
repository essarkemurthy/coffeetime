"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, UserX, UserCheck, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { ROLES, ROLE_LABELS, type AppUser, type Invite, type Role } from "@/lib/types";
import { useAppUser } from "@/lib/use-app-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/spinner";

// Owner-only: invite staff by email, change roles, switch
// accounts on/off. New staff sign in with email OTP — the invite
// links them to this shop on their first login.
export default function StaffPage() {
  const { user: me } = useAppUser();
  const [team, setTeam] = useState<AppUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ email: "", role: "cashier" as Role });

  const load = useCallback(async () => {
    setError("");
    const supabase = getSupabase();
    const [usersRes, invitesRes] = await Promise.all([
      supabase
        .from("users")
        .select("id, tenant_id, outlet_id, name, role, is_active")
        .order("created_at"),
      supabase
        .from("invites")
        .select("id, email, role, is_active, accepted_at, created_at")
        .is("accepted_at", null)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    ]);
    if (usersRes.error || invitesRes.error) {
      setError("Could not load the team. Please check your internet and refresh.");
    } else {
      setTeam((usersRes.data as AppUser[]) ?? []);
      setInvites((invitesRes.data as Invite[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const supabase = getSupabase();
    const { data: ctx } = await supabase.from("outlets").select("id, tenant_id").limit(1).single();
    const { error: err } = await supabase.from("invites").insert({
      tenant_id: ctx?.tenant_id,
      outlet_id: ctx?.id,
      email: form.email.trim().toLowerCase(),
      role: form.role,
    });
    setSaving(false);
    if (err) {
      setError(
        err.code === "23505"
          ? "This email already has a pending invite."
          : "Could not send the invite. Please try again."
      );
    } else {
      setDialog(false);
      setForm({ email: "", role: "cashier" });
      load();
    }
  }

  async function cancelInvite(id: string) {
    const { error: err } = await getSupabase().from("invites").update({ is_active: false }).eq("id", id);
    if (err) setError("Could not cancel the invite. Please try again.");
    else load();
  }

  async function changeRole(member: AppUser, role: Role) {
    const { error: err } = await getSupabase().from("users").update({ role }).eq("id", member.id);
    if (err) setError("Could not change the role. Please try again.");
    else load();
  }

  async function toggleActive(member: AppUser) {
    const { error: err } = await getSupabase()
      .from("users")
      .update({ is_active: !member.is_active })
      .eq("id", member.id);
    if (err) setError("Could not update the account. Please try again.");
    else load();
  }

  if (loading) return <PageLoader label="Loading team…" />;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-coffee-900">Staff</h1>
        <Button size="sm" onClick={() => setDialog(true)}>
          <Plus className="h-4 w-4" /> Invite
        </Button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <h2 className="mb-2 text-sm font-semibold text-gray-500">Team</h2>
      <div className="mb-6 grid gap-2">
        {team.map((member) => {
          const isMe = member.id === me?.id;
          return (
            <Card key={member.id} className={member.is_active ? "" : "opacity-60"}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {member.name || "(no name)"} {isMe && <Badge className="ml-1">You</Badge>}
                    {!member.is_active && <Badge className="ml-1 bg-red-100 text-red-700">Off</Badge>}
                  </p>
                  <p className="text-sm text-gray-500">{ROLE_LABELS[member.role]}</p>
                </div>
                {!isMe && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.role}
                      onChange={(e) => changeRole(member, e.target.value as Role)}
                      className="w-32"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => toggleActive(member)}>
                      {member.is_active ? (
                        <><UserX className="h-4 w-4" /> Switch off</>
                      ) : (
                        <><UserCheck className="h-4 w-4" /> Switch on</>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-500">Pending invites</h2>
      <div className="grid gap-2">
        {invites.map((inv) => (
          <Card key={inv.id}>
            <CardContent className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{inv.email}</p>
                <p className="text-sm text-gray-500">
                  {ROLE_LABELS[inv.role]} · invited {formatDate(inv.created_at)}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => cancelInvite(inv.id)}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            </CardContent>
          </Card>
        ))}
        {invites.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-500">No pending invites.</p>
        )}
      </div>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="Invite a staff member">
        <form onSubmit={sendInvite} className="space-y-4">
          <div>
            <Label htmlFor="s-email">Email</Label>
            <Input
              id="s-email"
              type="email"
              inputMode="email"
              placeholder="staff@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="s-role">Role</Label>
            <Select id="s-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-gray-500">
              Cashiers can bill and view sales. Managers can also edit the menu,
              stock, purchases and expenses. Owners can additionally manage staff.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>Send invite</Button>
          <p className="text-xs text-gray-500">
            They log in at this same website with their email and the 6-digit
            code — no password needed.
          </p>
        </form>
      </Dialog>
    </div>
  );
}
