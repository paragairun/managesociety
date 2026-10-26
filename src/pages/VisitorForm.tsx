import { useEffect, useState } from "react";
import { useSearchParams, useParams, Link } from "react-router-dom";
import { Car, Send, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VehicleNumberInput from "@/components/VehicleNumberInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { resolveSociety, type PublicSociety } from "@/lib/societyLookup";

const VisitorForm = () => {
  const [searchParams] = useSearchParams();
  const { societySlug } = useParams<{ societySlug?: string }>();
  const urlSocietyId = searchParams.get("s") || "";

  const [society, setSociety] = useState<PublicSociety | null>(null);
  const [looking, setLooking] = useState(true);
  const societyId = society?.id ?? "";
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "",
  });
  const { toast } = useToast();

  useEffect(() => {
    // One society, resolved from whichever handle the visitor arrived
    // with: the slug in /:societySlug/visitor/form, or the id printed
    // into a gate QR code as ?s=. Listing every society so the page
    // could find one by slug is exactly what published the customer
    // list, so the lookup now happens server-side and returns one row.
    let cancelled = false;
    void resolveSociety({ slug: societySlug, id: urlSocietyId }).then((found) => {
      if (cancelled) return;
      setSociety(found);
      setLooking(false);
    });
    return () => { cancelled = true; };
  }, [societySlug, urlSocietyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) {
      toast({ title: "Please select a society", variant: "destructive" });
      return;
    }
    if (!form.name || !form.phone || !form.vehicle_number || !form.flat_number) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.functions.invoke("submit-visitor-request", {
      body: {
        visitor_name: form.name.trim(),
        phone: form.phone.trim(),
        vehicle_number: form.vehicle_number.trim().toUpperCase(),
        purpose: form.purpose || null,
        flat_number: form.flat_number.trim().toUpperCase(),
        society_id: societyId,
      },
    });
    setIsSubmitting(false);

    if (error || data?.error) {
      toast({
        title: "Request failed",
        description: error?.message ?? data?.error ?? "Could not submit visitor request.",
        variant: "destructive",
      });
      return;
    }

    setSubmitted(true);
    toast({ title: "Request Submitted", description: "The guard will review your entry." });
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle className="h-16 w-16 text-success mx-auto" />
            <h2 className="text-2xl font-bold text-foreground">Request Submitted!</h2>
            <p className="text-muted-foreground">
              The security guard will review your entry. Please wait at the gate.
            </p>
            <Button variant="outline" onClick={() => { setSubmitted(false); setForm({ name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "" }); }} className="touch-target">
              Submit Another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Arrived with no handle, or one that resolves to nothing. The
  // dropdown that used to stand in here listed every society on the
  // platform to anyone who opened the page. A visitor reaches this form
  // from the gate's QR code or a link from the flat they are visiting.
  if (!looking && !society) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 space-y-4">
            <Car className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Scan the Gate QR Code</h2>
            <p className="text-muted-foreground text-sm">
              Please scan the QR code at the society gate, or use the link
              sent by the flat you are visiting, to open the right form.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center mb-2">
            <Car className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">{society?.name ?? "Visitor Entry"}</CardTitle>
          <p className="text-muted-foreground text-sm">Visitor Entry Registration</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Society</Label>
              {looking ? (
                <div className="h-10 rounded-md border border-border animate-pulse bg-secondary/40" />
              ) : (
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                  <p className="font-medium text-foreground">{society!.name}</p>
                  <p className="text-xs text-muted-foreground">{society!.city}, {society!.state}</p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Your Name *</Label>
              <Input id="name" placeholder="Enter your full name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <Input id="phone" type="tel" placeholder="10-digit phone number" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle">Vehicle Number *</Label>
              <VehicleNumberInput value={form.vehicle_number} onChange={(v) => setForm((p) => ({ ...p, vehicle_number: v }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flat">Flat Number (Wing-Flat) *</Label>
              <Input id="flat" placeholder="e.g. A-101" value={form.flat_number} onChange={(e) => setForm((p) => ({ ...p, flat_number: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purpose">Purpose of Visit</Label>
              <Select onValueChange={(v) => setForm((p) => ({ ...p, purpose: v }))}>
                <SelectTrigger className="touch-target">
                  <SelectValue placeholder="Select purpose" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Guest Visit">Guest Visit</SelectItem>
                  <SelectItem value="Delivery">Delivery</SelectItem>
                  <SelectItem value="Cab/Taxi">Cab / Taxi</SelectItem>
                  <SelectItem value="Maintenance">Maintenance</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" className="w-full touch-target text-lg font-bold gap-2" disabled={isSubmitting}>
              <Send className="h-5 w-5" />
              {isSubmitting ? "Submitting..." : "Submit Entry Request"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <Link to="/" className="hover:underline">← Back to home</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default VisitorForm;
