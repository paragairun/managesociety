import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type Amenity = Database["public"]["Tables"]["amenities"]["Row"];

const emptyForm = () => ({
  name: "", description: "", operating_hours_start: "06:00", operating_hours_end: "22:00",
  max_booking_hours: "2", requires_approval: true,
  usage_limit_count: "", usage_limit_period: "" as "" | "day" | "week" | "month",
});

const AmenitiesSetup = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const loadAmenities = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    const { data } = await supabase.from("amenities").select("*").eq("society_id", societyId).order("name");
    setAmenities(data ?? []);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void loadAmenities(); }, [loadAmenities]);

  const addAmenity = async () => {
    if (!societyId) return;
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (form.operating_hours_end <= form.operating_hours_start) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("amenities").insert({
      society_id: societyId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      operating_hours_start: form.operating_hours_start,
      operating_hours_end: form.operating_hours_end,
      max_booking_hours: Number(form.max_booking_hours) || 2,
      requires_approval: form.requires_approval,
      usage_limit_count: form.usage_limit_count ? Number(form.usage_limit_count) : null,
      usage_limit_period: form.usage_limit_period || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Could not add amenity", description: error.message, variant: "destructive" }); return; }
    setForm(emptyForm());
    toast({ title: "Amenity added" });
    await loadAmenities();
  };

  const toggleActive = async (a: Amenity) => {
    const { error } = await supabase.from("amenities").update({ is_active: !a.is_active }).eq("id", a.id);
    if (error) { toast({ title: "Could not update amenity", description: error.message, variant: "destructive" }); return; }
    await loadAmenities();
  };

  const toggleApproval = async (a: Amenity) => {
    const { error } = await supabase.from("amenities").update({ requires_approval: !a.requires_approval }).eq("id", a.id);
    if (error) { toast({ title: "Could not update amenity", description: error.message, variant: "destructive" }); return; }
    await loadAmenities();
  };

  const deleteAmenity = async (id: string) => {
    const { error } = await supabase.from("amenities").delete().eq("id", id);
    if (error) { toast({ title: "Could not delete amenity", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Amenity removed" });
    await loadAmenities();
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading amenities...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary-ink" /> Add an Amenity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input placeholder="e.g. Clubhouse" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label>Max booking length (hours)</Label>
              <Input type="number" step="0.5" value={form.max_booking_hours} onChange={(e) => setForm((p) => ({ ...p, max_booking_hours: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Description</Label>
              <Textarea placeholder="Any notes residents should see before booking" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Opens at</Label>
              <Input type="time" value={form.operating_hours_start} onChange={(e) => setForm((p) => ({ ...p, operating_hours_start: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label>Closes at</Label>
              <Input type="time" value={form.operating_hours_end} onChange={(e) => setForm((p) => ({ ...p, operating_hours_end: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label>Usage limit (optional)</Label>
              <Input type="number" placeholder="e.g. 2" value={form.usage_limit_count} onChange={(e) => setForm((p) => ({ ...p, usage_limit_count: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label>Per</Label>
              <Select value={form.usage_limit_period} onValueChange={(v: "day" | "week" | "month") => setForm((p) => ({ ...p, usage_limit_period: v }))}>
                <SelectTrigger className="touch-target"><SelectValue placeholder="No limit" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Switch checked={form.requires_approval} onCheckedChange={(v) => setForm((p) => ({ ...p, requires_approval: v }))} />
              <Label className="cursor-pointer">Requires admin approval before confirmed</Label>
            </div>
          </div>
          <Button onClick={() => void addAmenity()} disabled={saving} className="touch-target gap-2">
            <Plus className="h-4 w-4" /> {saving ? "Adding..." : "Add Amenity"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Your Amenities ({amenities.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {amenities.length === 0 && <p className="text-sm text-muted-foreground">No amenities yet. Add your first one above.</p>}
          {amenities.map((a) => (
            <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-sm text-muted-foreground">
                  {a.operating_hours_start.slice(0, 5)}–{a.operating_hours_end.slice(0, 5)} · up to {a.max_booking_hours}h
                  {a.usage_limit_count && a.usage_limit_period && ` · max ${a.usage_limit_count}/${a.usage_limit_period}`}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-center gap-2">
                  <Switch checked={a.requires_approval} onCheckedChange={() => void toggleApproval(a)} />
                  <span className="text-xs text-muted-foreground">Approval</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={a.is_active} onCheckedChange={() => void toggleActive(a)} />
                  <span className="text-xs text-muted-foreground">Active</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void deleteAmenity(a.id)} className="text-destructive-ink hover:text-destructive-ink">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default AmenitiesSetup;
