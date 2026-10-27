import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Trash2, Users, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import AddMemberForm from "@/components/AddMemberForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type UserRow = {
  user_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  wing: string | null;
  flat_number: string | null;
  vehicles: { vehicle_number: string; vehicle_type: string }[];
};

const roleColor = (role: string) => {
  switch (role) {
    case "admin": return "bg-primary text-primary-foreground";
    case "guard": return "bg-accent text-accent-foreground";
    case "resident": return "bg-secondary text-secondary-foreground";
    default: return "bg-muted text-muted-foreground";
  }
};

const UserRegistry = () => {
  const { societyId } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("list-users", {
      headers: { Authorization: `Bearer ${sess.session.access_token}` },
    });
    if (error || !data?.users) {
      toast({ title: "Could not load users", description: error?.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    setUsers(data.users as UserRow[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    const channel = supabase
      .channel("user-registry-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => { void fetchUsers(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { void fetchUsers(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => { void fetchUsers(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchUsers]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    let success = 0;
    let failed = 0;
    for (const userId of selected) {
      const { error } = await supabase.functions.invoke("delete-user", { body: { user_id: userId, society_id: societyId } });
      if (error) failed++; else success++;
    }
    setDeleting(false);
    setSelected(new Set());
    toast({
      title: `Deleted ${success} user(s)`,
      description: failed > 0 ? `${failed} failed` : undefined,
      variant: failed > 0 ? "destructive" : "default",
    });
    await fetchUsers();
  };

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (u.display_name?.toLowerCase().includes(q)) return true;
      if (u.email?.toLowerCase().includes(q)) return true;
      if (u.wing?.toLowerCase().includes(q)) return true;
      if (u.flat_number?.toLowerCase().includes(q)) return true;
      if (u.role.toLowerCase().includes(q)) return true;
      if (u.vehicles.some((v) => v.vehicle_number.toLowerCase().includes(q) || v.vehicle_type.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [users, searchQuery]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            User Registry ({filteredUsers.length})
          </CardTitle>
          {selected.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting} className="touch-target gap-1 text-xs">
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting..." : `Delete (${selected.size})`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} user(s)?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes their account, profile, and role. Vehicles registered to them will remain in the registry.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void deleteSelected()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* The only way an account is created now that nobody can
            register themselves. The role list narrows itself to what
            the signed-in person is allowed to create. */}
        <AddMemberForm onCreated={() => void fetchUsers()} />

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, role, wing, flat, or vehicle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
        ) : filteredUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
        ) : (
          <div className="space-y-2">
            {(expanded ? filteredUsers : filteredUsers.slice(0, 5)).map((u) => (
              <div key={u.user_id} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
                <Checkbox
                  checked={selected.has(u.user_id)}
                  onCheckedChange={() => toggle(u.user_id)}
                  className="mt-1 shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-foreground">{u.display_name ?? u.email ?? "Unnamed"}</p>
                    <Badge className={roleColor(u.role)}>{u.role}</Badge>
                    {u.wing && u.flat_number && (
                      <span className="text-xs text-muted-foreground">{formatFlat(u.wing, u.flat_number)}</span>
                    )}
                  </div>
                  {u.display_name && u.email && (
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  )}
                  {u.vehicles.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Vehicles: {u.vehicles.map((v) => `${v.vehicle_number} (${v.vehicle_type})`).join(", ")}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No vehicles registered</p>
                  )}
                </div>
              </div>
            ))}
            {filteredUsers.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
                className="w-full touch-target gap-1 text-xs"
              >
                {expanded ? (
                  <><ChevronUp className="h-4 w-4" /> Show less</>
                ) : (
                  <><ChevronDown className="h-4 w-4" /> Show {filteredUsers.length - 5} more</>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UserRegistry;