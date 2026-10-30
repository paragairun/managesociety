import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import { structureFields } from "@/lib/societyStructure";

interface FlatPickerProps {
  societyId: string | null | undefined;
  wing: string;
  flatNumber: string;
  onChange: (wing: string, flatNumber: string) => void;
  disabled?: boolean;
}

/**
 * Lets the user pick a Tower -> Wing -> Flat number, using the society's
 * configured structure (towers/wings/flat ranges) when available.
 * Falls back to free-text Wing + Flat Number inputs for societies that
 * haven't had a structure configured (e.g. legacy societies).
 */
const FlatPicker = ({ societyId, wing, flatNumber, onChange, disabled }: FlatPickerProps) => {
  const { structure, loading, hasStructure, flatsForWing, allWings } = useSocietyStructure(societyId);

  // Track the selected tower locally so the Wing dropdown can be scoped to it.
  const towerForWing = (w: string) => structure.find((t) => t.wings.some((x) => x.wing === w))?.tower_name;
  const [selectedTower, setSelectedTower] = useState<string | undefined>(() => towerForWing(wing));

  useEffect(() => {
    setSelectedTower(towerForWing(wing));
    // Only re-sync when the external wing value changes (e.g. switching residents/vehicles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wing, structure]);

  const wingsInTower = useMemo(
    () => structure.find((t) => t.tower_name === selectedTower)?.wings.map((w) => w.wing) ?? [],
    [structure, selectedTower],
  );

  // A field with fewer than two distinct values is hidden: it would be
  // a dropdown with one option that a guard taps past at every entry.
  // Same rule as the native apps, from the same function.
  const fields = useMemo(() => structureFields(structure), [structure]);

  /**
   * The wing to SAVE, which is not always the one shown.
   *
   * A single-wing society hides the picker, but entry_logs,
   * delivery_visits and flats all still carry a wing. Writing an empty
   * one would make that flat match nothing when a resident's app looks
   * for its own deliveries, so the only wing there is gets filled in.
   */
  const soleWing = useMemo(
    () => (allWings.length === 1 ? allWings[0].wing : ""),
    [allWings],
  );
  const wingToSave = wing || soleWing;

  const flatOptions = useMemo(
    () => (wingToSave ? flatsForWing(wingToSave) : []),
    [wingToSave, flatsForWing],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading flat list...</p>;
  }

  if (!hasStructure) {
    // Legacy fallback: free-text wing + flat number
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Wing</Label>
          <Input
            value={wing}
            onChange={(e) => onChange(e.target.value.toUpperCase(), flatNumber)}
            placeholder="A"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Flat Number</Label>
          <Input
            value={flatNumber}
            onChange={(e) => onChange(wing, e.target.value.toUpperCase())}
            placeholder="1201"
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  const columns = 1 + (fields.tower ? 1 : 0) + (fields.wing ? 1 : 0);

  return (
    <div className={`grid gap-3 ${columns === 3 ? "grid-cols-3" : columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {fields.tower && (
      <div className="space-y-2">
        <Label>Tower / Building</Label>
        <Select
          value={selectedTower ?? ""}
          onValueChange={(t) => {
            setSelectedTower(t);
            onChange("", ""); // reset wing/flat when tower changes
          }}
          disabled={disabled}
        >
          <SelectTrigger className="touch-target"><SelectValue placeholder="Select tower" /></SelectTrigger>
          <SelectContent>
            {structure.map((t) => (
              <SelectItem key={t.tower_name} value={t.tower_name}>{t.tower_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}
      {fields.wing && (
      <div className="space-y-2">
        <Label>Wing</Label>
        <Select
          value={wing}
          onValueChange={(w) => onChange(w, "")}
          disabled={disabled || (fields.tower && !selectedTower)}
        >
          <SelectTrigger className="touch-target"><SelectValue placeholder="Select wing" /></SelectTrigger>
          <SelectContent>
            {(fields.tower ? wingsInTower : allWings.map((w) => w.wing)).map((w) => (
              <SelectItem key={w} value={w}>Wing {w}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}
      <div className="space-y-2">
        <Label>Flat Number</Label>
        <Select
          value={flatNumber}
          onValueChange={(f) => onChange(wingToSave, f)}
          disabled={disabled || !wingToSave}
        >
          <SelectTrigger className="touch-target"><SelectValue placeholder="Select flat" /></SelectTrigger>
          <SelectContent>
            {flatOptions.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default FlatPicker;
