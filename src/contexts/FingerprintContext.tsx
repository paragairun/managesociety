import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getFingerprintDriver, type Candidate } from "@/lib/fingerprint";
import { FingerprintListener, type ListenerStatus, type AttendanceEvent } from "@/lib/fingerprintListener";
import { logStaffMovement } from "@/lib/staffAttendance";
import { FingerprintContext } from "@/contexts/fingerprint-context-core";

/**
 * Mounts the always-on fingerprint listener for signed-in guards.
 *
 * Lives above the router, so the scanner stays armed on every page of the
 * guard's session — the staff queue does not care which screen is open,
 * and the guard never presses anything. It starts itself when a reader
 * appears and re-arms itself if the cable is pulled.
 *
 * Only guards get a listener. Admin and resident sessions never open the
 * device, and signing out tears it down.
 */

export const FingerprintProvider = ({ children }: { children: ReactNode }) => {
  const { user, roles, societyId } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<ListenerStatus>("stopped");
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  const listenerRef = useRef<FingerprintListener | null>(null);

  const isGuard = roles.includes("guard");

  useEffect(() => {
    if (!isGuard || !user || !societyId) {
      void listenerRef.current?.stop();
      listenerRef.current = null;
      setStatus("stopped");
      return;
    }

    const loadGallery = async (): Promise<Candidate[]> => {
      const { data, error } = await supabase
        .from("gate_fingerprint_candidates")
        .select("enrollment_id, subject_id, subject_category, finger_position, template, name, role")
        .eq("society_id", societyId);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      setEnrolledCount(rows.length);
      return rows.map((r) => ({
        enrollmentId: String(r.enrollment_id),
        subjectId: String(r.subject_id),
        subjectCategory: r.subject_category as "society_staff" | "house_help",
        fingerPosition: Number(r.finger_position),
        template: String(r.template),
        name: String(r.name),
        role: String(r.role),
      }));
    };

    const onAttendance = async (event: AttendanceEvent) => {
      const result = await logStaffMovement(supabase, {
        societyId,
        subjectId: event.candidate.subjectId,
        category: event.candidate.subjectCategory,
        loggedBy: user.id,
        method: "fingerprint",
        matchScore: Math.round(event.score),
        deviceModel: event.deviceModel,
      });

      if (!result.ok) {
        toast({ title: "Could not log attendance", description: result.error, variant: "destructive" });
        return;
      }

      setLastScan({
        name: event.candidate.name,
        role: event.candidate.role,
        action: result.action,
        at: Date.now(),
      });
      toast({
        title: result.action === "entry" ? "Entry logged" : "Exit logged",
        description: `${event.candidate.name} — ${event.candidate.role}`,
      });
    };

    const listener = new FingerprintListener(getFingerprintDriver(), {
      loadGallery,
      onAttendance,
      onUnknownFinger: () => {
        toast({
          title: "Fingerprint not recognised",
          description: "Try again, or use the QR ID card.",
          variant: "destructive",
        });
      },
      onStatus: (s, detail) => { setStatus(s); setStatusDetail(detail); },
    });

    listenerRef.current = listener;
    listener.start();

    // New enrolments should start working at the gate without the guard
    // reloading anything.
    const channel = supabase
      .channel("fingerprint-enrollment-changes")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "fingerprint_enrollments" },
        () => listener.invalidateGallery())
      .subscribe();

    return () => {
      void listener.stop();
      void supabase.removeChannel(channel);
      listenerRef.current = null;
    };
  }, [isGuard, user, societyId, toast]);

  return (
    <FingerprintContext.Provider
      value={{
        status,
        statusDetail,
        enrolledCount,
        lastScan,
        refreshGallery: () => listenerRef.current?.invalidateGallery(),
      }}
    >
      {children}
    </FingerprintContext.Provider>
  );
};
