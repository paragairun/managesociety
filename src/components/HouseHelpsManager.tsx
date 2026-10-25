import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, IdCard, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import StaffIdCard from "@/components/StaffIdCard";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";

interface HouseHelp {
  id: string; name: string; help_type: string; phone: string | null;
  photo_base64: string | null; qr_code: string; is_active: boolean;
}

interface ResidentFlat { id: string; wing: string; flat_number: string; flat_label: string; }

interface LinkedHelp extends HouseHelp {
  flats: { wing: string; flat_number: string }[];
}

const HouseHelpsManager = ({ residentFlats }: { residentFlats: ResidentFlat[] }) => {
  const { societyId, user, societyName } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const { toast } = useToast();
  const [linked, setLinked] = useState<LinkedHelp[]>([]);
  const [available, setAvailable] = useState<HouseHelp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIdCard, setShowIdCard] = useState<LinkedHelp | null>(null);
  const [linkingFor, setLinkingFor] = useState<HouseHelp | null>(null);
  const [selectedFlatId, setSelectedFlatId] = useState("");

  const fetchHelps = useCallback(async () => {
    if (!user || !societyId) return;
    setLoading(true);

    // 1. House helps already linked to this resident's flats
    const { data: linkData } = await supabase.from("house_help_flats").select("house_help_id, wing, flat_number").eq("resident_id", user.id);
    if (linkData && linkData.length > 0) {
      const helpIds = [...new Set(linkData.map((l: { house_help_id: string }) => l.house_help_id))];
      const { data: helpData } = await supabase.from("house_helps").select("*").in("id", helpIds).eq("society_id", societyId);
      setLinked((helpData ?? []).map((h) => ({
        ...h,
        flats: linkData.filter((l: { house_help_id: string; wing: string; flat_number: string }) => l.house_help_id === h.id).map((l: { wing: string; flat_number: string }) => ({ wing: l.wing, flat_number: l.flat_number })),
      })));
    } else {
      setLinked([]);
    }

    // 2. All active house helps registered by the society admin (not yet linked by this resident)
    const linkedIds = new Set(linkData?.map((l: { house_help_id: string }) => l.house_help_id) ?? []);
    const { data: allHelps, error: allHelpsErr } = await supabase.from("house_helps").select("*").eq("society_id", societyId).eq("is_active", true);
    if (allHelpsErr) {
      console.error("[HouseHelpsManager] Could not load available house helps:", allHelpsErr.message);
      toast({ title: "Could not load available house helps", description: allHelpsErr.message, variant: "destructive" });
    }
    const unlinked = (allHelps ?? []).filter((h: HouseHelp) => !linkedIds.has(h.id));
    setAvailable(unlinked);
    setLoading(false);
  }, [user, societyId]);

  useEffect(() => { void fetchHelps(); }, [fetchHelps]);

  const handleLink = async () => {
    if (!linkingFor || !user || !societyId || !selectedFlatId) return;
    const flat = residentFlats.find((f) => f.id === selectedFlatId);
    if (!flat) return;

    const { error } = await supabase.from("house_help_flats").insert({
      house_help_id: linkingFor.id, resident_id: user.id, wing: flat.wing, flat_number: flat.flat_number,
    });
    if (error) { toast({ title: "Failed to link", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${linkingFor.name} linked to ${formatFlat(flat.wing, flat.flat_number)}` });
    setLinkingFor(null); setSelectedFlatId("");
    await fetchHelps();
  };

  const removeHelp = async (help: LinkedHelp) => {
    if (!user) return;
    await supabase.from("house_help_flats").delete().eq("house_help_id", help.id).eq("resident_id", user.id);
    toast({ title: `${help.name} unlinked from your flats` });
    await fetchHelps();
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">My House Helps</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 flex justify-center"><div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {linked.length > 0 && (
              <div className="space-y-2 mb-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Linked to your flats</h3>
                {linked.map((h) => (
                  <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                    <div className="flex items-center gap-3">
                      {h.photo_base64 ? (
                        <img src={h.photo_base64} alt={h.name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                          {h.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-sm">{h.name}</p>
                        <p className="text-xs text-muted-foreground">{h.help_type} • {h.flats.map((f) => formatFlat(f.wing, f.flat_number)).join(", ")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setShowIdCard(h)} title="View ID Card"><IdCard className="h-4 w-4" /></Button>
                      <Button size="icon" variant="outline" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => void removeHelp(h)} title="Unlink"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {available.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available house helps</h3>
                <p className="text-xs text-muted-foreground mb-2">Select a house help registered by the society admin and link it to your flat:</p>
                {available.map((h) => (
                  <div key={h.id} className="flex items-center justify-between p-2 rounded-lg border border-border bg-secondary/20">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                        {h.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{h.name}</p>
                        <p className="text-xs text-muted-foreground">{h.help_type}{h.phone ? ` • ${h.phone}` : ""}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setLinkingFor(h)} className="gap-1">
                      <Link className="h-3 w-3" /> Link to my flat
                    </Button>
                  </div>
                ))}

                {linkingFor && (
                  <Dialog open={!!linkingFor} onOpenChange={(o) => !o && setLinkingFor(null)}>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Link "{linkingFor.name}"</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label>Works for flat *</Label>
                          <Select value={selectedFlatId} onValueChange={setSelectedFlatId}>
                            <SelectTrigger><SelectValue placeholder="Select flat..." /></SelectTrigger>
                            <SelectContent>
                              {residentFlats.map((f) => (
                                <SelectItem key={f.id} value={f.id}>{formatFlat(f.wing, f.flat_number)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setLinkingFor(null)}>Cancel</Button>
                        <Button onClick={() => void handleLink()} disabled={!selectedFlatId}>
                          Link
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}
          </>
        )}

        {!loading && linked.length === 0 && available.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No house helps available for your society.</p>
        )}
      </CardContent>

      <Dialog open={!!showIdCard} onOpenChange={(o) => !o && setShowIdCard(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>ID Card — {showIdCard?.name}</DialogTitle></DialogHeader>
          {showIdCard && (
            <StaffIdCard qrCode={showIdCard.qr_code} name={showIdCard.name} role={showIdCard.help_type}
              category="house_help" photoBase64={showIdCard.photo_base64} societyName={societyName}
              flats={showIdCard.flats.map((f) => formatFlat(f.wing, f.flat_number))}
              fileBaseName={showIdCard.name.toLowerCase().replace(/\s+/g, "-")} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default HouseHelpsManager;
