import { useCallback, useEffect, useState } from "react";
import { Trash2, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import StaffIdCard from "@/components/StaffIdCard";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";

interface HouseHelp {
  id: string; name: string; help_type: string; phone: string | null;
  photo_base64: string | null; qr_code: string; is_active: boolean;
  flats: { wing: string; flat_number: string }[];
}

interface ResidentFlat { id: string; wing: string; flat_number: string; flat_label: string; }

const HouseHelpsManager = ({ residentFlats }: { residentFlats: ResidentFlat[] }) => {
  const { societyId, user, societyName } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const { toast } = useToast();
  const [helps, setHelps] = useState<HouseHelp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIdCard, setShowIdCard] = useState<HouseHelp | null>(null);

  const fetchHelps = useCallback(async () => {
    if (!user || !societyId) return;
    setLoading(true);
    const { data: linkData } = await supabase.from("house_help_flats").select("house_help_id, wing, flat_number").eq("resident_id", user.id);
    if (!linkData || linkData.length === 0) { setHelps([]); setLoading(false); return; }
    const helpIds = [...new Set(linkData.map((l: { house_help_id: string }) => l.house_help_id))];
    const { data: helpData } = await supabase.from("house_helps").select("*").in("id", helpIds).eq("society_id", societyId);
    setHelps((helpData ?? []).map((h) => ({
      ...h,
      flats: linkData.filter((l: { house_help_id: string; wing: string; flat_number: string }) => l.house_help_id === h.id).map((l: { wing: string; flat_number: string }) => ({ wing: l.wing, flat_number: l.flat_number })),
    })));
    setLoading(false);
  }, [user, societyId]);

  useEffect(() => { void fetchHelps(); }, [fetchHelps]);

  const removeHelp = async (help: HouseHelp) => {
    if (!user) return;
    await supabase.from("house_help_flats").delete().eq("house_help_id", help.id).eq("resident_id", user.id);
    toast({ title: `${help.name} removed from your flats` });
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
        ) : helps.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No house helps registered yet.</p>
        ) : (
          <div className="space-y-2">
            {helps.map((h) => (
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
                    <p className="text-xs text-muted-foreground">{h.help_type}{h.flats.length > 0 ? ` • ${h.flats.map((f) => formatFlat(f.wing, f.flat_number)).join(", ")}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setShowIdCard(h)} title="View ID Card"><IdCard className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => void removeHelp(h)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
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
