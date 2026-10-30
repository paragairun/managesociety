import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, CheckCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import SocietyStructureBuilder from "@/components/SocietyStructureBuilder";
import { TowerStructure, emptyTower, normalizeStructure } from "@/lib/societyStructure";

const SocietyRegister = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    society_name: "",
    address_line: "",
    landmark: "",
    city: "",
    state: "",
    country: "India",
    pin_code: "",
    admin_display_name: "",
    admin_email: "",
    admin_phone: "",
    admin_password: "",
    confirm_password: "",
  });

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const [towers, setTowers] = useState<TowerStructure[]>([emptyTower()]);
  const [floorWise, setFloorWise] = useState(false);
  const [flatsPerFloor, setFlatsPerFloor] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const required: Array<keyof typeof form> = [
      "society_name", "address_line", "city", "state", "country", "pin_code",
      "admin_display_name", "admin_email", "admin_password", "confirm_password",
    ];
    for (const k of required) {
      if (!form[k].trim()) {
        toast({ title: `Please fill ${k.replace(/_/g, " ")}`, variant: "destructive" });
        return;
      }
    }

    const email = form.admin_email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Enter a valid admin email", variant: "destructive" });
      return;
    }
    if (form.admin_password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (form.admin_password !== form.confirm_password) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!/^\d{4,10}$/.test(form.pin_code.trim())) {
      toast({ title: "Enter a valid PIN/ZIP code", variant: "destructive" });
      return;
    }

    // Validate + normalize society structure
    const structureResult = normalizeStructure(towers, floorWise, flatsPerFloor);
    if ("error" in structureResult) {
      toast({ title: structureResult.error, variant: "destructive" });
      return;
    }
    const normalizedTowers = structureResult.structure;

    setSaving(true);
    const { error } = await supabase.from("society_registration_requests").insert({
      society_name: form.society_name.trim(),
      address_line: form.address_line.trim(),
      landmark: form.landmark.trim() || null,
      city: form.city.trim(),
      state: form.state.trim(),
      country: form.country.trim(),
      pin_code: form.pin_code.trim(),
      society_structure: normalizedTowers as unknown as Json,
      admin_display_name: form.admin_display_name.trim(),
      admin_email: email,
      admin_phone: form.admin_phone.trim() || null,
      admin_password: form.admin_password,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not submit", description: error.message, variant: "destructive" });
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle className="h-16 w-16 text-success-ink mx-auto" />
            <h2 className="text-2xl font-bold text-foreground">Society registration submitted!</h2>
            <p className="text-muted-foreground">
              Our platform team will review your request and activate your society shortly.
              You will receive an email at <span className="font-mono">{form.admin_email}</span> once approved.
            </p>
            <Button onClick={() => navigate("/")}>Back to home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Card>
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-primary-ink" />
            </div>
            <CardTitle className="text-2xl">Register Your Society</CardTitle>
            <p className="text-sm text-muted-foreground">
              Tell us about your society. Once approved, you'll be able to log in as the admin and onboard your residents and guards.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-5">
              <section className="space-y-3">
                <h3 className="font-semibold text-foreground">Society details</h3>
                <div className="space-y-2">
                  <Label>Society name *</Label>
                  <Input value={form.society_name} onChange={update("society_name")} placeholder="e.g. Skyline Towers CHSL" />
                </div>
                <div className="space-y-2">
                  <Label>Address line *</Label>
                  <Input value={form.address_line} onChange={update("address_line")} placeholder="Building name, street" />
                </div>
                <div className="space-y-2">
                  <Label>Landmark</Label>
                  <Input value={form.landmark} onChange={update("landmark")} placeholder="Nearby landmark (optional)" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>City *</Label>
                    <Input value={form.city} onChange={update("city")} />
                  </div>
                  <div className="space-y-2">
                    <Label>State *</Label>
                    <Input value={form.state} onChange={update("state")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Country *</Label>
                    <Input value={form.country} onChange={update("country")} />
                  </div>
                  <div className="space-y-2">
                    <Label>PIN / ZIP *</Label>
                    <Input value={form.pin_code} onChange={update("pin_code")} />
                  </div>
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-border">
                <div>
                  <h3 className="font-semibold text-foreground">Society structure</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Add each building/tower in your society, its wings, and the flat number range for each wing
                    (e.g. Wing A, flats 101 to 412). This helps residents and the admin pick the right flat later.
                    <strong className="block mt-1">This cannot be changed after approval except by the platform team.</strong>
                  </p>
                </div>

                <SocietyStructureBuilder
                  towers={towers}
                  floorWise={floorWise}
                  flatsPerFloor={flatsPerFloor}
                  onChangeTowers={setTowers}
                  onChangeFloorWise={setFloorWise}
                  onChangeFlatsPerFloor={setFlatsPerFloor}
                  disabled={saving}
                />
              </section>

              <section className="space-y-3 pt-2 border-t border-border">
                <h3 className="font-semibold text-foreground">Admin account</h3>
                <p className="text-xs text-muted-foreground">
                  This is the account that will manage your society. You'll be able to add more admins later.
                </p>
                <div className="space-y-2">
                  <Label>Admin full name *</Label>
                  <Input value={form.admin_display_name} onChange={update("admin_display_name")} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Admin email *</Label>
                    <Input type="email" value={form.admin_email} onChange={update("admin_email")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Admin phone</Label>
                    <Input value={form.admin_phone} onChange={update("admin_phone")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Password *</Label>
                    <Input type="password" value={form.admin_password} onChange={update("admin_password")} placeholder="Min 8 characters" />
                  </div>
                  <div className="space-y-2">
                    <Label>Confirm password *</Label>
                    <Input type="password" value={form.confirm_password} onChange={update("confirm_password")} />
                  </div>
                </div>
              </section>

              <Button type="submit" size="lg" className="w-full text-base font-bold" disabled={saving}>
                {saving ? "Submitting..." : "Submit Registration"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SocietyRegister;
