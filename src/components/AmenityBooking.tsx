import { useCallback, useEffect, useState } from "react";
import { Sparkles, Calendar, Clock, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type Amenity = Database["public"]["Tables"]["amenities"]["Row"];
type Booking = Database["public"]["Tables"]["amenity_bookings"]["Row"];

interface ResidentFlat { id: string; wing: string; flat_number: string; is_primary: boolean; flat_label: string; }

interface AmenityBookingProps {
  residentFlats: ResidentFlat[];
}

const STATUS_STYLES: Record<string, string> = {
  pending_approval: "bg-warning/10 text-warning-ink",
  approved: "bg-success/10 text-success-ink",
  rejected: "bg-destructive/10 text-destructive-ink",
  cancelled: "bg-muted text-muted-foreground",
  completed: "bg-secondary text-muted-foreground",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = (flatId: string) => ({
  amenityId: "", flatId, date: todayStr(), start_time: "", end_time: "", notes: "",
});

const AmenityBooking = ({ residentFlats }: AmenityBookingProps) => {
  const { user, societyId } = useAuth();
  const { toast } = useToast();
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm(residentFlats[0]?.id ?? ""));

  const loadData = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    await supabase.rpc("complete_past_amenity_bookings", { p_society_id: societyId });
    const [{ data: amenitiesData }, { data: bookingsData }] = await Promise.all([
      supabase.from("amenities").select("*").eq("society_id", societyId).eq("is_active", true).order("name"),
      supabase.from("amenity_bookings").select("*").order("booking_date", { ascending: false }).order("start_time", { ascending: false }),
    ]);
    setAmenities(amenitiesData ?? []);
    setBookings(bookingsData ?? []);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const selectedAmenity = amenities.find((a) => a.id === form.amenityId);

  const submitBooking = async () => {
    if (!user || !societyId) return;
    const flat = residentFlats.find((f) => f.id === form.flatId);
    if (!selectedAmenity || !flat || !form.date || !form.start_time || !form.end_time) {
      toast({ title: "Fill in all fields", variant: "destructive" });
      return;
    }
    if (form.end_time <= form.start_time) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    const hours = (new Date(`2000-01-01T${form.end_time}`).getTime() - new Date(`2000-01-01T${form.start_time}`).getTime()) / 3600000;
    if (hours > selectedAmenity.max_booking_hours) {
      toast({ title: `Bookings for ${selectedAmenity.name} are capped at ${selectedAmenity.max_booking_hours}h`, variant: "destructive" });
      return;
    }
    if (form.start_time < selectedAmenity.operating_hours_start.slice(0, 5) || form.end_time > selectedAmenity.operating_hours_end.slice(0, 5)) {
      toast({ title: "Outside operating hours", description: `${selectedAmenity.name} is open ${selectedAmenity.operating_hours_start.slice(0, 5)}–${selectedAmenity.operating_hours_end.slice(0, 5)}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("amenity_bookings").insert({
      amenity_id: selectedAmenity.id, society_id: societyId, wing: flat.wing, flat_number: flat.flat_number,
      booked_by: user.id, booking_date: form.date, start_time: form.start_time, end_time: form.end_time,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not book", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: selectedAmenity.requires_approval ? "Booking requested" : "Booking confirmed", description: selectedAmenity.requires_approval ? "Waiting on admin approval." : "Your slot is confirmed." });
    setForm(emptyForm(residentFlats[0]?.id ?? ""));
    await loadData();
  };

  const cancelBooking = async (id: string) => {
    const { error } = await supabase.from("amenity_bookings").update({ status: "cancelled" }).eq("id", id);
    if (error) { toast({ title: "Could not cancel", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Booking cancelled" });
    await loadData();
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading amenities...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary-ink" /> Book an Amenity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {amenities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No amenities have been set up yet.</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Amenity</Label>
                  <Select value={form.amenityId} onValueChange={(v) => setForm((p) => ({ ...p, amenityId: v }))}>
                    <SelectTrigger className="touch-target"><SelectValue placeholder="Choose an amenity" /></SelectTrigger>
                    <SelectContent>
                      {amenities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {residentFlats.length > 1 && (
                  <div className="space-y-2">
                    <Label>Flat</Label>
                    <Select value={form.flatId} onValueChange={(v) => setForm((p) => ({ ...p, flatId: v }))}>
                      <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {residentFlats.map((f) => <SelectItem key={f.id} value={f.id}>{f.flat_label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {selectedAmenity && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground bg-secondary/40 rounded-lg p-3">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    {selectedAmenity.description && <p className="mb-1">{selectedAmenity.description}</p>}
                    <p>
                      Open {selectedAmenity.operating_hours_start.slice(0, 5)}–{selectedAmenity.operating_hours_end.slice(0, 5)} ·
                      {" "}max {selectedAmenity.max_booking_hours}h per booking
                      {selectedAmenity.usage_limit_count && selectedAmenity.usage_limit_period && ` · max ${selectedAmenity.usage_limit_count} per ${selectedAmenity.usage_limit_period}`}
                      {selectedAmenity.requires_approval ? " · needs admin approval" : " · instantly confirmed"}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" min={todayStr()} value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="touch-target" />
                </div>
                <div className="space-y-2">
                  <Label>Start time</Label>
                  <Input type="time" value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} className="touch-target" />
                </div>
                <div className="space-y-2">
                  <Label>End time</Label>
                  <Input type="time" value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} className="touch-target" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea placeholder="e.g. Birthday party for 15 people" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <Button onClick={() => void submitBooking()} disabled={saving || !form.amenityId} className="touch-target">
                {saving ? "Booking..." : "Request Booking"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">My Bookings</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No bookings yet.</p>
          ) : (
            bookings.map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
                <div>
                  <p className="font-medium">{amenities.find((a) => a.id === b.amenity_id)?.name ?? "Amenity"}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(b.booking_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    <Clock className="h-3.5 w-3.5 ml-2" />
                    {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
                  </p>
                  {b.rejection_reason && <p className="text-sm text-destructive-ink mt-1">Rejected: {b.rejection_reason}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[b.status]}`}>{b.status.replace("_", " ")}</span>
                  {(b.status === "pending_approval" || b.status === "approved") && (
                    <Button variant="ghost" size="sm" onClick={() => void cancelBooking(b.id)} className="text-destructive-ink hover:text-destructive-ink">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AmenityBooking;
