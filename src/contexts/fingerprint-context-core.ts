import { createContext } from "react";
import type { ListenerStatus } from "@/lib/fingerprintListener";

interface LastScan {
  name: string;
  role: string;
  action: "entry" | "exit";
  at: number;
}

interface FingerprintContextValue {
  status: ListenerStatus;
  statusDetail?: string;
  enrolledCount: number;
  lastScan: LastScan | null;
  /** Force a gallery refresh, e.g. right after someone is enrolled. */
  refreshGallery: () => void;
}

export const FingerprintContext = createContext<FingerprintContextValue>({
  status: "stopped",
  enrolledCount: 0,
  lastScan: null,
  refreshGallery: () => {},
});


