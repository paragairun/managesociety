import { useCallback, useEffect, useState } from "react";
import { User, Save, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface ProfileForm { display_name: string; phone: string }

const AdminProfile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [profileForm, setProfileForm] = useState<ProfileForm>({ display_name: "", phone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("profiles").select("display_name, phone")
      .eq("user_id", user.id).maybeSingle();
    setProfileForm({ display_name: data?.display_name ?? "", phone: data?.phone ?? "" });
    setLoading(false);
  }, [user]);

  useEffect(() => { void fetchProfile(); }, [fetchProfile]);

  const saveProfile = async () => {
    if (!user) return;
    if (!profileForm.display_name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase.from("profiles").update({
      display_name: profileForm.display_name.trim(),
      phone: profileForm.phone?.trim() || null,
    }).eq("user_id", user.id);
    setSavingProfile(false);
    if (error) {
      toast({ title: "Failed to save profile", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated" });
    }
  };

  const savePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast({ title: "Failed to update password", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated successfully" });
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary-ink" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-primary-ink" /> My Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="admin-profile-name">Full Name *</Label>
              <Input
                id="admin-profile-name"
                placeholder="Your name"
                value={profileForm.display_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, display_name: e.target.value }))}
                className="touch-target"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-profile-phone">Mobile Number</Label>
              <Input
                id="admin-profile-phone"
                placeholder="e.g. 9876543210"
                value={profileForm.phone ?? ""}
                onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                className="touch-target"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="admin-profile-email">Email</Label>
              <Input id="admin-profile-email" value={user?.email ?? ""} disabled className="touch-target" />
            </div>
          </div>
          <Button onClick={() => void saveProfile()} disabled={savingProfile} className="touch-target gap-2">
            <Save className="h-4 w-4" /> {savingProfile ? "Saving..." : "Save Profile"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-primary-ink" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="admin-new-password">New Password</Label>
              <Input
                id="admin-new-password"
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="touch-target"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-confirm-password">Confirm Password</Label>
              <Input
                id="admin-confirm-password"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="touch-target"
                autoComplete="new-password"
              />
            </div>
          </div>
          <Button onClick={() => void savePassword()} disabled={savingPassword} className="touch-target gap-2">
            <KeyRound className="h-4 w-4" /> {savingPassword ? "Updating..." : "Update Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminProfile;
