import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { sizeLabel, type UnitType } from "@/lib/societyUnits";
import {
  positionsIn, positionLabels, unitKeyOf, duplicateWings, type UnitPlan,
} from "@/lib/floorPlan";
import type { NormalizedTower } from "@/lib/societyStructure";

const NONE = "__none__";

interface Props {
  towers: NormalizedTower[];
  unitTypes: UnitType[];
  plan: UnitPlan;
  onChange: (plan: UnitPlan) => void;
  disabled?: boolean;
}

/**
 * One floor of each wing, position by position.
 *
 * The committee fills in a single floor and every floor above it
 * follows, because the building was built that way. Positions are
 * labelled with the first floor's real flat numbers — 101, 102, 103 —
 * because that is how a committee thinks about its building. "Position
 * 3" is a thing they would have to decode, and a form people decode is
 * a form they fill in wrong.
 *
 * Controlled, like UnitTypesBuilder: no state, no saving. Validation
 * lives in normalizeUnitPlan so the rules are testable without
 * rendering, and so every caller rejects the same things in the same
 * words.
 */
const FloorPlanBuilder = ({ towers, unitTypes, plan, onChange, disabled }: Props) => {
  const setPosition = (wing: string, index: number, key: string | null) => {
    const count = towers.flatMap((t) => t.wings).find((w) => w.wing === wing);
    const width = count ? positionsIn(count) ?? 0 : 0;
    const current = plan[wing] ?? [];
    const next = Array.from({ length: width }, (_, i) => (i === index ? key : current[i] ?? null));
    onChange({ ...plan, [wing]: next });
  };

  /**
   * Copy the first filled position across the rest of the floor.
   *
   * Common enough to be worth a button: plenty of wings are one unit
   * type throughout, and clicking the same value into six selects is
   * where a committee gives up and leaves the plan half done.
   */
  const fillWing = (wing: string, width: number) => {
    const current = plan[wing] ?? [];
    const first = current.find((p) => p);
    if (!first) return;
    onChange({ ...plan, [wing]: Array.from({ length: width }, () => first) });
  };

  const clearWing = (wing: string, width: number) =>
    onChange({ ...plan, [wing]: Array.from({ length: width }, () => null) });

  const ambiguous = duplicateWings(towers);

  const planeableWings = towers.flatMap((tower) =>
    tower.wings
      .filter((wing) => positionsIn(wing) !== null && !ambiguous.includes(wing.wing))
      .map((wing) => ({ tower: tower.tower_name, wing })),
  );

  /* Said before anything else, because every other message on this
     screen would be beside the point while the structure is
     ambiguous — and because a committee can do nothing about it
     themselves. */
  if (ambiguous.length > 0) {
    return (
      <p className="text-sm text-warning-ink">
        Wing {ambiguous.join(", ")} appears in more than one of your towers, so a floor
        plan cannot tell which one is meant — and stamping the wrong one would bill those
        flats at another tower's rates. Ask the platform team to give each wing its own
        name (such as Tower&nbsp;1&#8209;A and Tower&nbsp;2&#8209;A) and this will work.
      </p>
    );
  }

  if (unitTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Define your unit types above first — the floor plan picks from them.
      </p>
    );
  }

  if (planeableWings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        None of your wings is set up floor by floor, so there is no repeating floor
        to describe. Set each flat's unit on the flats list under Maintenance &amp;
        Billing instead — you can tick several and set them together.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {planeableWings.map(({ tower, wing }) => {
        const width = positionsIn(wing)!;
        const labels = positionLabels(wing);
        const positions = plan[wing.wing] ?? [];
        const filled = positions.filter((p) => p).length;

        return (
          <div key={`${tower}|${wing.wing}`} className="rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h4 className="font-semibold text-foreground text-sm">
                  {tower} — Wing {wing.wing}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {width} flat{width === 1 ? "" : "s"} per floor ×{" "}
                  {wing.total_floors} floor{wing.total_floors === 1 ? "" : "s"}
                  {filled > 0 && ` · ${filled} of ${width} set`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => fillWing(wing.wing, width)}
                  disabled={disabled || !positions.some((p) => p)}
                  title="Copy the first unit across this whole floor"
                >
                  Same throughout
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={() => clearWing(wing.wing, width)}
                  disabled={disabled || filled === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: width }, (_, i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`plan-${wing.wing}-${i}`} className="text-xs">
                    {/* The real flat number, and what it stands for. */}
                    Flat {labels[i] ?? i + 1}
                    <span className="text-muted-foreground font-normal">
                      {" "}and the flat above it on every floor
                    </span>
                  </Label>
                  <Select
                    value={positions[i] ?? NONE}
                    onValueChange={(v) => setPosition(wing.wing, i, v === NONE ? null : v)}
                    disabled={disabled}
                  >
                    <SelectTrigger id={`plan-${wing.wing}-${i}`} className="touch-target">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {unitTypes.flatMap((t) => t.sizes.map((sz) => (
                        <SelectItem key={unitKeyOf(t.name, sz.sqft)} value={unitKeyOf(t.name, sz.sqft)}>
                          {t.name} — {sizeLabel(sz)}
                        </SelectItem>
                      )))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FloorPlanBuilder;
