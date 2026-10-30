import { useCallback, useEffect, useState } from "react";
import { Wallet, Receipt, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Bill = Database["public"]["Tables"]["maintenance_bills"]["Row"];
type LineItem = Database["public"]["Tables"]["maintenance_bill_line_items"]["Row"];
type Payment = Database["public"]["Tables"]["maintenance_payments"]["Row"];

interface ResidentFlat { id: string; wing: string; flat_number: string; flat_label: string; }

interface MyDuesProps {
  residentFlats: ResidentFlat[];
  formatFlat: (wing: string, flatNumber: string) => string;
}

const STATUS_STYLES: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  paid: { label: "Paid", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
  partial: { label: "Partially Paid", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Clock },
  unpaid: { label: "Unpaid", className: "bg-secondary text-muted-foreground", icon: Receipt },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: AlertCircle },
};

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const MyDues = ({ residentFlats, formatFlat }: MyDuesProps) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [lineItems, setLineItems] = useState<Record<string, LineItem[]>>({});
  const [payments, setPayments] = useState<Record<string, Payment[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  const loadDues = useCallback(async () => {
    setLoading(true);
    // RLS already scopes this to the resident's own flat(s) -- including via
    // a parent account lookup for child/tenant logins -- so no extra filter needed here.
    const { data: billsData } = await supabase
      .from("maintenance_bills")
      .select("*")
      .order("billing_period_start", { ascending: false });

    const billList = billsData ?? [];
    setBills(billList);

    if (billList.length > 0) {
      const billIds = billList.map((b) => b.id);
      const [{ data: liData }, { data: payData }] = await Promise.all([
        supabase.from("maintenance_bill_line_items").select("*").in("bill_id", billIds),
        supabase.from("maintenance_payments").select("*").in("bill_id", billIds).order("payment_date", { ascending: false }),
      ]);
      const liByBill: Record<string, LineItem[]> = {};
      (liData ?? []).forEach((li) => { (liByBill[li.bill_id] ??= []).push(li); });
      setLineItems(liByBill);

      const payByBill: Record<string, Payment[]> = {};
      (payData ?? []).forEach((p) => { (payByBill[p.bill_id] ??= []).push(p); });
      setPayments(payByBill);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadDues(); }, [loadDues]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading your dues...</div>;

  const totalOutstanding = bills.reduce((sum, b) => sum + Math.max(0, b.total_amount - b.amount_paid), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Wallet className="h-5 w-5 text-primary-ink" /> My Dues</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">Total outstanding:</span>
            <span className={`text-2xl font-bold ${totalOutstanding > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {money(totalOutstanding)}
            </span>
          </div>
        </CardContent>
      </Card>

      {bills.length === 0 && (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No bills generated yet.</CardContent></Card>
      )}

      {bills.map((bill) => {
        const status = STATUS_STYLES[bill.status] ?? STATUS_STYLES.unpaid;
        const StatusIcon = status.icon;
        const outstanding = Math.max(0, bill.total_amount - bill.amount_paid);
        const isExpanded = expandedBillId === bill.id;
        const flatLabel = residentFlats.find((f) => f.wing === bill.wing && f.flat_number === bill.flat_number)
          ? formatFlat(bill.wing, bill.flat_number)
          : `${bill.wing}-${bill.flat_number}`;

        return (
          <Card key={bill.id} className="overflow-hidden">
            <button
              className="w-full text-left"
              onClick={() => setExpandedBillId(isExpanded ? null : bill.id)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{flatLabel}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(bill.billing_period_start).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                    {" – "}
                    {new Date(bill.billing_period_end).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                    {" · Due "}
                    {new Date(bill.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${status.className}`}>
                    <StatusIcon className="h-3 w-3" /> {status.label}
                  </span>
                  <span className="font-semibold">{money(bill.total_amount)}</span>
                  {outstanding > 0 && <span className="text-xs text-red-600 dark:text-red-400">{money(outstanding)} due</span>}
                </div>
              </CardContent>
            </button>

            {isExpanded && (
              <CardContent className="pt-0 pb-4 border-t border-border">
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Breakdown</p>
                  {(lineItems[bill.id] ?? []).map((li) => (
                    <div key={li.id} className="flex justify-between text-sm">
                      <span>{li.description}</span>
                      <span>{money(li.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-medium pt-1 border-t border-border mt-1">
                    <span>Total</span>
                    <span>{money(bill.total_amount)}</span>
                  </div>
                </div>

                {(payments[bill.id] ?? []).length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment History</p>
                    {(payments[bill.id] ?? []).map((p) => (
                      <div key={p.id} className="flex justify-between text-sm">
                        <span>
                          {new Date(p.payment_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          {" · "}
                          <span className="capitalize">{p.payment_method.replace("_", " ")}</span>
                          {p.reference_number && ` (${p.reference_number})`}
                        </span>
                        <span className="text-green-600 dark:text-green-400">{money(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default MyDues;
