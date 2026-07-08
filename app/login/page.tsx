"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coffee } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

// Login with email OTP: enter email → receive a 6-digit code → enter code.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError("Could not send the code. Please check the email and try again.");
    } else {
      setStep("otp");
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await getSupabase().auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) {
      setError("That code didn't work. Please check it and try again.");
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-coffee-700 text-white">
            <Coffee className="h-7 w-7" />
          </div>
          <CardTitle className="text-xl">CoffeeTime</CardTitle>
          <p className="text-sm text-gray-500">Sign in to manage your shop</p>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={sendOtp} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? <Spinner className="text-white" /> : "Send login code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-4">
              <p className="text-sm text-gray-600">
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
              </p>
              <div>
                <Label htmlFor="otp">Login code</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? <Spinner className="text-white" /> : "Sign in"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-coffee-700 underline"
                onClick={() => setStep("email")}
              >
                Use a different email
              </button>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
