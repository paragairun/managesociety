import { useCallback, useEffect, useState } from "react";
import { Check, X, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type Booking = Database["public"]["Tables"]["amenity_bookings"]["Row"];
type Amenity = Database["public"]["Tables"]["amenities"]["Row"];

const STATUS_STYLES: Record<string, string> = {
  pending_approval: "bg-warning/10 text-warning-ink",
  approved: "bg-success/10 text-success-ink",
  rejected: "bg-destructive/10 text-destructive-ink",
  cancelled: "bg-muted text-muted-foreground",
  completed: "bg-secondary text-muted-foreground",
};

const AmenityBookingsAdmin = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [amenities, setAmenities] = useState<Record<string, Amenity>>({});
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const loadBookings = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    await supabase.rpc("complete_past_amenity_bookings", { p_society_id: societyId });
    const [{ data: bookingsData }, { data: amenitiesData }] = await Promise.all([
      supabase.from("amenity_bookings").select("*").eq("society_id", societyId)
        .order("booking_date", { ascending: false }).order("start_time", { ascending: false }),
      supabase.from("amenities").select("*").eq("society_id", societyId),
    ]);
    setBookings(bookingsData ?? []);
    setAmenities(Object.fromEntries((amenitiesData ?? []).map((a) => [a.id, a])));
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void loadBookings(); }, [loadBookings]);

  const approve = async (id: string) => {
    setProcessingId(id);
    const { error } = await supabase.from("amenity_bookings").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", id);
    setProcessingId(null);
    if (error) { toast({ title: "Could not approve", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Booking approved" });
    await loadBookings();
  };

  const reject = async (id: string) => {
    setProcessingId(id);
    const { error } = await supabase.from("amenity_bookings")
      .update({ status: "rejected", reviewed_at: new Date().toISOString(), rejection_reason: rejectionReason.trim() || null })
      .eq("id", id);
    setProcessingId(null);
    setRejectingId(null);
    setRejectionReason("");
    if (error) { toast({ title: "Could not reject", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Booking rejected" });
    await loadBookings();
  };

  const pending = bookings.filter((b) => b.status === "pending_approval");
  const others = bookings.filter((b) => b.status !== "pending_approval");

  if (loading) return <div className="p-6 text-muted-foreground">Loading bookings...</div>;

  const renderBooking = (b: Booking) => (
    <div key={b.id} className="p-3 rounded-lg bg-secondary/50 border border-border space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{amenities[b.amenity_id]?.name ?? "Amenity"} · {b.wing}-{b.flat_number}</p>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {new Date(b.booking_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            {" · "}{b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
          </p>
          {b.notes && <p className="text-sm text-muted-foreground mt-1">"{b.notes}"</p>}
          {b.rejection_reason && <p className="text-sm text-destructive-ink mt-1">Rejected: {b.rejection_reason}</p>}
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${STATUS_STYLES[b.status]}`}>
          {b.status.replace("_", " ")}
        </span>
      </div>
      {b.status === "pending_approval" && (
        rejectingId === b.id ? (
          <div className="space-y-2">
            <Textarea placeholder="Reason for rejection (optional)" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="text-sm" />
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => void reject(b.id)} disabled={processingId === b.id}>Confirm reject</Button>
              <Button size="sm" variant="ghost" onClick={() => { setRejectingId(null); setRejectionReason(""); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void approve(b.id)} disabled={processingId === b.id} className="gap-1 bg-success hover:bg-success/80">
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejectingId(b.id)} disabled={processingId === b.id} className="gap-1 border-destructive/50 text-destructive-ink hover:bg-destructive hover:text-destructive-foreground">
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        )
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="h-3 w-3 rounded-full bg-warning animate-pulse" />
            Pending Approval ({pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No bookings awaiting approval</p> : pending.map(renderBooking)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">All Bookings</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {others.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No other bookings yet</p> : others.map(renderBooking)}
        </CardContent>
      </Card>
    </div>
  );
};

export default AmenityBookingsAdmin;
