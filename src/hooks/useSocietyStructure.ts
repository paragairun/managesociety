import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  parseStoredStructure, towerForWing, formatFlatAddress, flatsForWing, allWings,
  type NormalizedTower, type NormalizedStructure,
} from "@/lib/societyStructure";

/**
 * Loads the approved structure (towers -> wings -> flat number ranges) for a
 * society. Returns empty state if the society has no structure defined yet
 * (legacy societies), in which case consuming components fall back to
 * free-text inputs.
 *
 * The fetch is all this hook does. Every lookup it returns is a thin
 * binding over a pure function in @/lib/societyStructure, because the
 * native guard app needs the same flat formatting and cannot use a hook.
 */
export const useSocietyStructure = (societyId: string | null | undefined) => {
  const [towers, setTowers] = useState<NormalizedTower[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!societyId) { setTowers([]); return; }
    let active = true;
    setLoading(true);
    void supabase
      .from("society_structure")
      .select("structure")
      .eq("society_id", societyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) { setTowers([]); return; }
        setTowers(parseStoredStructure(
          data?.structure as unknown as NormalizedStructure | NormalizedTower[] | null,
        ));
      });
    return () => { active = false; };
  }, [societyId]);

  return {
    structure: towers, // keep 'structure' alias for FlatPicker compatibility
    loading,
    hasStructure: towers.length > 0,
    allWings: allWings(towers),
    flatsForWing: (wing: string) => flatsForWing(towers, wing),
    towerForWing: (wing: string) => towerForWing(towers, wing),
    formatFlat: (wing: string, flatNumber: string) => formatFlatAddress(towers, wing, flatNumber),
  };
};
