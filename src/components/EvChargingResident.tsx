import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Zap, Plug, AlertCircle, Wallet, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { evDb } from "@/lib/evDb";
import { useAuth } from "@/contexts/AuthContext";
import {
  VEHICLE_LABEL, STATUS_LABEL, splitWithCredit, validateAmount, validateUtr,
  normaliseUtr, upiPaymentLink, energyBudgetKwh, isChargerAvailable,
  isSessionOpen, chargeProgress, minutesLeftToPay, formatKwh, formatRupees,
  type Charger, type SessionStatus, type VehicleType,
} from "@/lib/evCharging";

/**
 * Resident EV charging: pick a charger, pay, charge.
 *
 * The flow is deliberately explicit about the fact that payment is not
 * instant. UPI gives no callback, so after paying the resident enters
 * the UTR and waits either for the bank alert to be matched or for a
 * guard to confirm. Pretending it is instant would leave them standing
 * at a charger that never starts.
 */

interface Session {
  id: string; status: SessionStatus; charger_id: string;
  amount_paid: number; credit_applied: number; rate_per_kwh: number;
  energy_budget_kwh: number | null; kwh_consumed: number | null;
  cost: number | null; utr: string | null; created_at: string;
  started_at: string | null; ended_at: string | null;
}

interface Settings {
  rate_per_kwh: number; min_amount: number; max_amount: number;
  payment_window_mins: number; upi_vpa: string | null; upi_payee_name: string | null;
}

const EvChargingResident = () => {
  const { societyId, user } = useAuth();
  const { toast } = useToast();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [credit, setCredit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [picked, setPicked] = useState<Charger | null>(null);
  const [amount, setAmount] = useState("100");
  const [utr, setUtr] = useState("");
  const [filter, setFilter] = useState<"all" | VehicleType>("all");

  const qrRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    if (!societyId || !user) return;
    setError(null);

    const [sRes, cRes, openRes, balRes] = await Promise.all([
      evDb.from("ev_settings")
        .select("rate_per_kwh, min_amount, max_amount, payment_window_mins, upi_vpa, upi_payee_name")
        .eq("society_id", societyId).maybeSingle(),
      evDb.from("ev_chargers_public").select("*").eq("is_active", true).order("name"),
      evDb.from("ev_sessions").select("*")
        .eq("user_id", user.id)
        .in("status", ["awaiting_payment", "awaiting_approval", "authorized", "charging"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      evDb.rpc<number>("ev_credit_balance", { _user: user.id }),
    ]);

    const firstError = sRes.error || cRes.error || openRes.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }

    setSettings(sRes.data as unknown as Settings);
    setChargers((cRes.data ?? []) as unknown as Charger[]);
    setSession((openRes.data as unknown as Session) ?? null);
    setCredit(Number(balRes.data ?? 0));
    setLoading(false);
  }, [societyId, user]);

  useEffect(() => { void load(); }, [load]);

  // While a session is live the charger reports progress every few
  // seconds; poll so the resident sees it move without refreshing.
  useEffect(() => {
    if (!session || !isSessionOpen(session.status)) return;
    const t = setInterval(() => { void load(); }, 8000);
    return () => clearInterval(t);
  }, [session, load]);

  const amountNum = Number(amount);
  const split = splitWithCredit(Number.isFinite(amountNum) ? amountNum : 0, credit);

  // The QR is built per session with the amount already in it, so the
  // resident cannot mistype the figure.
  const payLink = settings && session
    ? upiPaymentLink({
        vpa: settings.upi_vpa,
        payeeName: settings.upi_payee_name,
        amount: Number(session.amount_paid),
        note: `EV charging ${String(session.id).slice(0, 8)}`,
      })
    : null;

  useEffect(() => {
    if (!payLink || !qrRef.current) return;
    QRCode.toCanvas(qrRef.current, payLink, { width: 220, margin: 1 })
      .catch(() => { /* a failed render shows the fallback text below */ });
  }, [payLink]);

  const startSession = async () => {
    if (!picked || !settings || !societyId || !user) return;
    const problem = validateAmount(amountNum, settings);
    if (problem) { toast({ title: problem, variant: "destructive" }); return; }

    setBusy(true);
    // amount_paid carries the TOTAL to spend; the database decides how
    // much of it credit covers and what is left to pay.
    const { error: err } = await evDb.from("ev_sessions").insert({
      society_id: societyId,
      charger_id: picked.id,
      user_id: user.id,
      amount_paid: amountNum,
    });
    setBusy(false);

    if (err) {
      const busyCharger = err.message.includes("ev_sessions_one_open_per_charger");
      toast({
        title: busyCharger ? "That charger is already in use" : "Could not start",
        description: busyCharger ? "Pick another, or try again when it is free." : err.message,
        variant: "destructive",
      });
      return;
    }
    setPicked(null);
    void load();
  };

  const submitUtr = async () => {
    if (!session) return;
    const problem = validateUtr(utr);
    if (problem) { toast({ title: problem, variant: "destructive" }); return; }

    setBusy(true);
    const { error: err } = await evDb.from("ev_sessions")
      .update({ utr: normaliseUtr(utr), status: "awaiting_approval" })
      .eq("id", session.id);
    setBusy(false);

    if (err) {
      const reused = err.message.includes("ev_sessions_utr_uniq");
      toast({
        title: reused ? "That UTR is already used" : "Could not submit",
        description: reused
          ? "Each payment reference can only be used once. Check you copied the right one."
          : err.message,
        variant: "destructive",
      });
      return;
    }
    setUtr("");
    void load();
  };

  const cancelSession = async () => {
    if (!session) return;
    setBusy(true);
    await evDb.from("ev_sessions").update({ status: "cancelled" }).eq("id", session.id);
    setBusy(false);
    void load();
  };

  if (loading) {
    return <div className="py-10 flex justify-center">
      <div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
        <AlertCircle className="h-4 w-4 text-destructive-ink mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-destructive-ink">EV charging could not be loaded</p>
          <p className="text-xs text-muted-foreground break-words">{error}</p>
        </div>
      </div>
    );
  }

  // ── A session is in progress ──
  if (session) {
    const progress = chargeProgress(session.kwh_consumed, session.energy_budget_kwh);
    const minsLeft = settings
      ? minutesLeftToPay(session.created_at, settings.payment_window_mins) : null;
    const charger = chargers.find((c) => c.id === session.charger_id);

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {STATUS_LABEL[session.status]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {charger?.name ?? "Charger"}
              {" · "}buys {formatKwh(session.energy_budget_kwh)} at {formatRupees(session.rate_per_kwh)}/kWh
            </p>

            {session.status === "awaiting_payment" && (
              <>
                <div className="rounded-lg border border-border p-4 text-center space-y-2">
                  <p className="text-2xl font-bold">{formatRupees(session.amount_paid)}</p>
                  {session.credit_applied > 0 && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {formatRupees(session.credit_applied)} credit applied
                    </p>
                  )}
                  {payLink ? (
                    <>
                      <canvas ref={qrRef} className="mx-auto" />
                      <p className="text-xs text-muted-foreground">
                        Scan with any UPI app — the amount is already filled in
                      </p>
                      <a href={payLink} className="text-xs underline text-primary-ink">
                        or tap to open your UPI app
                      </a>
                    </>
                  ) : (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      No UPI ID has been set for this society yet. Ask your admin
                      to add it under EV charging settings.
                    </p>
                  )}
                </div>

                {minsLeft !== null && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {minsLeft > 0
                      ? `${minsLeft} minute${minsLeft === 1 ? "" : "s"} left to pay`
                      : "Payment window has passed — this session may be cancelled"}
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="ev-utr">After paying, enter the UTR</Label>
                  <Input
                    id="ev-utr" inputMode="numeric" placeholder="12-digit reference"
                    value={utr} onChange={(e) => setUtr(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your UPI app shows this as UTR, RRN or transaction reference.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void submitUtr()} disabled={busy}>
                    I have paid
                  </Button>
                  <Button variant="outline" onClick={() => void cancelSession()} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </>
            )}

            {session.status === "awaiting_approval" && (
              <div className="rounded-lg border border-border p-4 space-y-2">
                <p className="text-sm">
                  Payment of {formatRupees(session.amount_paid)} submitted with UTR{" "}
                  <span className="font-mono">{session.utr}</span>.
                </p>
                <p className="text-xs text-muted-foreground">
                  This is checked against the society's bank credits. If it is
                  not matched automatically, a guard or admin will confirm it.
                  The charger starts as soon as it is confirmed.
                </p>
                <Button variant="outline" size="sm" onClick={() => void cancelSession()} disabled={busy}>
                  Cancel
                </Button>
              </div>
            )}

            {session.status === "authorized" && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
                <p className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Payment confirmed. Plug in — the charger will start on its own.
                </p>
              </div>
            )}

            {session.status === "charging" && (
              <div className="space-y-2">
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary transition-all"
                       style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span>{formatKwh(session.kwh_consumed)} delivered</span>
                  <span className="text-muted-foreground">
                    of {formatKwh(session.energy_budget_kwh)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Charging stops automatically when the paid-for energy runs out.
                  Anything you do not use comes back as credit.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── No session: choose a charger ──
  const visible = chargers.filter((c) => filter === "all" || c.vehicle_type === filter);

  return (
    <div className="space-y-4">
      {credit > 0 && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-600" />
          <p className="text-sm">
            You have {formatRupees(credit)} credit — it will be used on your next session.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {(["all", "four_wheeler", "two_wheeler"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}>
            {f === "all" ? "All" : VEHICLE_LABEL[f]}
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No chargers available{filter !== "all" ? " for this vehicle type" : ""}.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => {
            const free = isChargerAvailable(c);
            return (
              <button
                key={c.id}
                onClick={() => free && setPicked(c)}
                disabled={!free}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  picked?.id === c.id ? "border-primary bg-primary/5"
                  : free ? "border-border bg-secondary/30 hover:bg-secondary/50"
                  : "border-border/40 bg-secondary/10 opacity-60 cursor-not-allowed"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Plug className="h-3.5 w-3.5" /> {c.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {VEHICLE_LABEL[c.vehicle_type]}
                      {c.power_kw ? ` · ${c.power_kw} kW` : ""}
                      {c.connector_type ? ` · ${c.connector_type}` : ""}
                      {c.location ? ` · ${c.location}` : ""}
                    </p>
                  </div>
                  <span className={`text-xs shrink-0 ${free ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {free ? "Available" : c.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {picked && settings && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How much to charge?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              {[50, 100, 200, 500].filter((v) => v >= settings.min_amount && v <= settings.max_amount)
                .map((v) => (
                  <Button key={v} size="sm" variant={amount === String(v) ? "default" : "outline"}
                          onClick={() => setAmount(String(v))}>
                    ₹{v}
                  </Button>
                ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-amount">Amount (₹)</Label>
              <Input id="ev-amount" type="number" inputMode="numeric"
                     min={settings.min_amount} max={settings.max_amount}
                     value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Buys about {formatKwh(energyBudgetKwh(amountNum, settings.rate_per_kwh))} at{" "}
                {formatRupees(settings.rate_per_kwh)}/kWh
              </p>
            </div>

            {split.creditApplied > 0 && (
              <div className="text-sm rounded-lg border border-border p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credit applied</span>
                  <span>−{formatRupees(split.creditApplied)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>To pay now</span>
                  <span>{formatRupees(split.cashToPay)}</span>
                </div>
              </div>
            )}

            <Button className="w-full" onClick={() => void startSession()} disabled={busy}>
              {split.cashToPay === 0
                ? `Start charging on ${picked.name}`
                : `Continue — pay ${formatRupees(split.cashToPay)}`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EvChargingResident;
