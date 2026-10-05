import { useContext } from "react";
import { FingerprintContext } from "@/contexts/fingerprint-context-core";

/**
 * Live state of the always-on fingerprint listener.
 * Separate from the context file so React Fast Refresh keeps working
 * (a module exporting both a component and a hook breaks it).
 */
export const useFingerprint = () => useContext(FingerprintContext);
