import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Filter, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";

interface AccessLog {
  id: string;
  vehicle_id: string;
  timestamp: string;
  action_type: string;
  status: string;
  logged_by: string | null;
  created_at: string;
  vehicles: {
    vehicle_number: string;
    owner_name: string;
    wing: string;
    flat_number: string;
    vehicle_type: string;
  } | null;
}

const AccessLogsViewer = () => {
  const { societyId } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("access_logs")
      .select("*, vehicles(vehicle_number, owner_name, wing, flat_number, vehicle_type)")
      .order("timestamp", { ascending: false })
      .limit(200);

    if (actionFilter !== "all") query = query.eq("action_type", actionFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);

    const { data, error } = await query;
    setLoading(false);

    if (error) {
      toast({ title: "Failed to load access logs", description: error.message, variant: "destructive" });
      return;
    }
    setLogs((data as unknown as AccessLog[]) ?? []);
  }, [actionFilter, statusFilter, toast]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const filtered = logs.filter((log) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const v = log.vehicles;
    return (
      v?.vehicle_number?.toLowerCase().includes(s) ||
      v?.owner_name?.toLowerCase().includes(s) ||
      v?.flat_number?.toLowerCase().includes(s) ||
      v?.wing?.toLowerCase().includes(s)
    );
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardList className="h-5 w-5 text-primary-ink" />
          Access Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[180px]">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search vehicle, owner, flat..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="touch-target"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[130px] touch-target">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="entry">Entry</SelectItem>
              <SelectItem value="exit">Exit</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] touch-target">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="granted">Granted</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => void fetchLogs()} className="touch-target shrink-0">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Log list */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {loading && logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No access logs found</p>
          ) : (
            filtered.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-foreground">
                    {log.vehicles?.vehicle_number ?? "Unknown Vehicle"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {log.vehicles?.owner_name} • {formatFlat(log.vehicles?.wing ?? "", log.vehicles?.flat_number ?? "")} • {log.vehicles?.vehicle_type}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(log.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={log.action_type === "entry" ? "default" : "secondary"}>
                    {log.action_type === "entry" ? "↓ Entry" : "↑ Exit"}
                  </Badge>
                  <Badge variant={log.status === "granted" ? "outline" : "destructive"}>
                    {log.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AccessLogsViewer;
