import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emptyUnitType, emptyUnitSize, type UnitTypeDraft,
} from "@/lib/societyUnits";

interface Props {
  drafts: UnitTypeDraft[];
  onChange: (drafts: UnitTypeDraft[]) => void;
  disabled?: boolean;
  /**
   * Prefix for the generated input ids.
   *
   * Two of these can appear on one page — the super-admin dashboard
   * shows the structure and the unit catalogue for the same society —
   * and duplicate ids would make a <Label htmlFor> point at whichever
   * input the browser found first, so clicking "Unit type" in the
   * second editor would focus a field in the first.
   */
  idPrefix?: string;
}

/**
 * The unit catalogue editor: what kinds of flat a society has, and the
 * sizes each comes in.
 *
 * Controlled — it holds no state of its own and never saves anything.
 * That is what lets the same control sit in three places that persist
 * it quite differently: the public registration form (into a pending
 * request, nothing else exists yet), the super-admin dashboard (into
 * society_structure beside the towers, for a society being set up on
 * someone's behalf), and the admin panel (into the same row, by the
 * committee, after approval).
 *
 * Validation lives in normalizeUnitTypes rather than here, so every
 * caller rejects the same things with the same words — and so the rules
 * are testable without rendering anything. The matching database
 * triggers in supabase/schema/ are the backstop for a row that arrives
 * by some other route.
 */
const UnitTypesBuilder = ({ drafts, onChange, disabled, idPrefix = "unit" }: Props) => {
  const addType = () => onChange([...drafts, emptyUnitType()]);
  const removeType = (ti: number) => onChange(drafts.filter((_, i) => i !== ti));
  const setTypeName = (ti: number, name: string) =>
    onChange(drafts.map((t, i) => (i === ti ? { ...t, name } : t)));
  const addSize = (ti: number) =>
    onChange(drafts.map((t, i) => (
      i === ti ? { ...t, sizes: [...t.sizes, emptyUnitSize()] } : t)));
  const removeSize = (ti: number, si: number) =>
    onChange(drafts.map((t, i) => (
      i === ti ? { ...t, sizes: t.sizes.filter((_, j) => j !== si) } : t)));
  const setSize = (ti: number, si: number, field: "sqft" | "label", value: string) =>
    onChange(drafts.map((t, i) => (
      i === ti
        ? { ...t, sizes: t.sizes.map((s, j) => (j === si ? { ...s, [field]: value } : s)) }
        : t)));

  return (
    <div className="space-y-4">
      {drafts.map((type, ti) => (
        <div key={ti} className="rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`${idPrefix}-name-${ti}`}>Unit type</Label>
              <Input
                id={`${idPrefix}-name-${ti}`}
                value={type.name}
                onChange={(e) => setTypeName(ti, e.target.value)}
                placeholder="3BHK"
                disabled={disabled}
              />
            </div>
            <Button
              type="button"
              variant="ghost" size="icon"
              onClick={() => removeType(ti)}
              /* The last one stays: an empty editor gives a committee
                 nothing to type into and no obvious way back. */
              disabled={disabled || drafts.length === 1}
              aria-label={`Remove ${type.name || "this unit type"}`}
            >
              <Trash2 className="h-4 w-4 text-destructive-ink" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Sizes</Label>
            {type.sizes.map((size, si) => (
              <div key={si} className="flex items-center gap-2">
                <Input
                  value={size.sqft}
                  onChange={(e) => setSize(ti, si, "sqft", e.target.value)}
                  placeholder="1050"
                  inputMode="numeric"
                  className="w-32"
                  disabled={disabled}
                  aria-label="Area in square feet"
                />
                <span className="text-sm text-muted-foreground">sq ft</span>
                <Input
                  value={size.label}
                  onChange={(e) => setSize(ti, si, "label", e.target.value)}
                  placeholder="label (optional) — e.g. corner"
                  className="flex-1"
                  disabled={disabled}
                  aria-label="Optional label for this size"
                />
                <Button
                  type="button"
                  variant="ghost" size="icon"
                  onClick={() => removeSize(ti, si)}
                  disabled={disabled || type.sizes.length === 1}
                  aria-label="Remove this size"
                >
                  <Trash2 className="h-4 w-4 text-destructive-ink" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline" size="sm"
              onClick={() => addSize(ti)}
              disabled={disabled}
              className="gap-1"
            >
              <Plus className="h-3 w-3" /> Add a size
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={addType}
        disabled={disabled}
        className="gap-1"
      >
        <Plus className="h-4 w-4" /> Add a unit type
      </Button>
    </div>
  );
};

export default UnitTypesBuilder;
