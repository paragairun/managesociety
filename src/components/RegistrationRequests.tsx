import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import { UserCheck, UserX, Clock, Loader2, Trash2 } from "lucide-react";

interface RegistrationRequest {
  id: string;
  email: string;
  display_name: string;
  requested_role: string;
  flat_number: string | null;
  wing: string | null;
  status: string;
  created_at: string;
}

const RegistrationRequests = () => {
  const { societyId } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchRequests = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);

    const { data, error } = await supabase
      .from("registration_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Could not load registration requests", description: error.message, variant: "destructive" });
    } else if (data) {
      setRequests(data as RegistrationRequest[]);
    }

    if (showLoader) setLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchRequests(true);

    const interval = window.setInterval(() => {
      void fetchRequests(false);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [fetchRequests]);

  const handleAction = async (requestId: string, action: "approve" | "reject") => {
    setProcessingId(requestId);

    const { data, error } = await supabase.functions.invoke("approve-registration", {
      body: { request_id: requestId, action },
    });

    setProcessingId(null);

    if (error) {
      toast({ title: "Action failed", description: error.message, variant: "destructive" });
      return;
    }

    if (data?.error) {
      toast({ title: "Action failed", description: data.error, variant: "destructive" });
      return;
    }

    if (action === "approve" && data?.temp_password) {
      toast({
        title: "User Approved",
        description: `Temp password for ${data.email}: ${data.temp_password}`,
        duration: 15000,
      });
    } else if (action === "approve" && data?.existing_user) {
      toast({
        title: "Role Added",
        description: `${data.email} already has an account. New role added — they can sign in with their existing password.`,
        duration: 12000,
      });
    } else {
      toast({ title: action === "approve" ? "Approved" : "Rejected" });
    }

    void fetchRequests(false);
  };

  const handleDelete = async (requestId: string) => {
    setDeletingId(requestId);
    const { error } = await supabase.from("registration_requests").delete().eq("id", requestId);
    setDeletingId(null);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Request deleted" });
    void fetchRequests(false);
  };

  const handleApproveAll = async () => {
    const pending = requests.filter((r) => r.status === "pending");
    if (pending.length === 0) return;

    setApprovingAll(true);
    let successCount = 0;
    const passwords: string[] = [];

    for (const req of pending) {
      const { data, error } = await supabase.functions.invoke("approve-registration", {
        body: { request_id: req.id, action: "approve" },
      });

      if (!error && !data?.error) {
        successCount++;
        if (data?.temp_password) {
          passwords.push(`${data.email}: ${data.temp_password}`);
        }
      }
    }

    setApprovingAll(false);

    if (passwords.length > 0) {
      toast({
        title: `Approved ${successCount} user(s)`,
        description: passwords.join(" | "),
        duration: 30000,
      });
    } else {
      toast({ title: `Approved ${successCount} user(s)` });
    }

    void fetchRequests(false);
  };

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const processedRequests = requests.filter((r) => r.status !== "pending");

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "guard": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "resident": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "visitor": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      default: return "";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-primary-ink" />
            User Registration Requests ({pendingRequests.length} pending)
          </CardTitle>
          {pendingRequests.length > 1 && (
            <Button
              size="sm"
              onClick={() => void handleApproveAll()}
              disabled={approvingAll || processingId !== null}
              className="gap-1"
            >
              {approvingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
              {approvingAll ? "Approving..." : `Approve All (${pendingRequests.length})`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingRequests.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No pending requests</p>
        )}

        {pendingRequests.map((req) => (
          <div key={req.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="space-y-1">
              <p className="font-semibold text-foreground">{req.display_name}</p>
              <p className="text-sm text-muted-foreground">{req.email}</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={roleBadgeColor(req.requested_role)}>
                  {req.requested_role}
                </Badge>
                {req.flat_number && (
                  <span className="text-xs text-muted-foreground">
                    {req.wing && req.flat_number ? formatFlat(req.wing, req.flat_number) : (req.flat_number ?? "")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-500 border-green-500/30 hover:bg-green-500/10"
                onClick={() => handleAction(req.id, "approve")}
                disabled={processingId === req.id}
              >
                {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                onClick={() => handleAction(req.id, "reject")}
                disabled={processingId === req.id}
              >
                <UserX className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        {processedRequests.length > 0 && (
          <details className="pt-2">
            <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
              Processed requests ({processedRequests.length})
            </summary>
            <div className="space-y-2 mt-2">
              {processedRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 border border-border/50">
                  <div>
                    <p className="text-sm font-medium text-foreground">{req.display_name}</p>
                    <p className="text-xs text-muted-foreground">{req.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={roleBadgeColor(req.requested_role)}>
                      {req.requested_role}
                    </Badge>
                    <Badge variant={req.status === "approved" ? "default" : "destructive"}>
                      {req.status}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive-ink"
                      onClick={() => void handleDelete(req.id)}
                      disabled={deletingId === req.id}
                    >
                      {deletingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
};

export default RegistrationRequests;
