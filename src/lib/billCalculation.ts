/**
 * What a flat owes, given the society's charge heads.
 *
 * Three ways a charge can be worked out, and a society uses all three
 * in the same bill:
 *
 *   per_unit_type   ₹1,200 for a 2BHK, ₹1,800 for a 3BHK. How most
 *                   societies actually bill for lifts, security and
 *                   common electricity — the cost follows the size of
 *                   household rather than the floor area.
 *   per_sqft        rate × area. Sinking fund and property-linked
 *                   charges, where the floor area is the fair measure.
 *   fixed           the same for every flat. A one-off repair levy, a
 *                   festival fund.
 *
 * Kept apart from the UI because this is the arithmetic a committee is
 * answerable for. A resident who disputes a bill is disputing these
 * lines, and "the spreadsheet said so" is not an answer.
 */

export type ChargeCalculation = "per_unit_type" | "per_sqft" | "fixed";

export interface ChargeHead {
  id: string;
  name: string;
  calculation_type: ChargeCalculation;
  /** Used by per_sqft (rate per square foot) and fixed (the amount). */
  rate: number;
  /** Used by per_unit_type: { "2BHK": 1200, "3BHK": 1800 }. */
  unit_rates?: Record<string, number> | null;
  is_active?: boolean;
}

export interface FlatForBilling {
  id: string;
  flat_number: string;
  wing: string;
  /** The unit type name from the society's catalogue, if assigned. */
  flat_type: string | null;
  area_sqft: number;
}

export interface BillLine {
  head_id: string;
  description: string;
  amount: number;
}

export interface FlatBill {
  flat_id: string;
  lines: BillLine[];
  total: number;
  /**
   * Heads that could not be applied to this flat, and why.
   *
   * NOT silently skipped. A flat with no unit type assigned drops out
   * of every per_unit_type charge, which on a 200-flat society is a
   * hole in the month's collection that nobody sees until the totals
   * are compared against last month. The caller is expected to show
   * these before the bills are issued.
   */
  skipped: { head_id: string; head_name: string; reason: string }[];
}

/** Rounded to the nearest rupee. Societies bill in whole rupees. */
const rupees = (n: number): number => Math.round(n * 100) / 100;

/**
 * Work out one flat's bill.
 *
 * A head that does not apply is reported rather than dropped, and a
 * head that applies at zero is included as a zero line — "security:
 * ₹0" is information, where a missing line is a question.
 */
export function billForFlat(flat: FlatForBilling, heads: ChargeHead[]): FlatBill {
  const lines: BillLine[] = [];
  const skipped: FlatBill["skipped"] = [];

  for (const head of heads) {
    if (head.is_active === false) continue;

    switch (head.calculation_type) {
      case "fixed": {
        lines.push({ head_id: head.id, description: head.name, amount: rupees(head.rate) });
        break;
      }

      case "per_sqft": {
        if (!Number.isFinite(flat.area_sqft) || flat.area_sqft <= 0) {
          skipped.push({
            head_id: head.id, head_name: head.name,
            reason: "no area recorded for this flat",
          });
          break;
        }
        lines.push({
          head_id: head.id,
          description: `${head.name} (${flat.area_sqft} sq ft × ₹${head.rate})`,
          amount: rupees(head.rate * flat.area_sqft),
        });
        break;
      }

      case "per_unit_type": {
        if (!flat.flat_type) {
          skipped.push({
            head_id: head.id, head_name: head.name,
            reason: "no unit type assigned to this flat",
          });
          break;
        }
        const rate = head.unit_rates?.[flat.flat_type];
        if (rate === undefined || rate === null) {
          // Deliberately not an error. A lift charge may genuinely not
          // apply to a ground-floor shop, and the committee expresses
          // that by leaving the unit type out of the map. It is still
          // reported, so the one that was an oversight is visible too.
          skipped.push({
            head_id: head.id, head_name: head.name,
            reason: `no rate set for ${flat.flat_type}`,
          });
          break;
        }
        if (!Number.isFinite(rate)) {
          skipped.push({
            head_id: head.id, head_name: head.name,
            reason: `the rate for ${flat.flat_type} is not a number`,
          });
          break;
        }
        lines.push({
          head_id: head.id,
          description: `${head.name} (${flat.flat_type})`,
          amount: rupees(rate),
        });
        break;
      }
    }
  }

  return {
    flat_id: flat.id,
    lines,
    total: rupees(lines.reduce((sum, l) => sum + l.amount, 0)),
    skipped,
  };
}

export interface BillRun {
  bills: FlatBill[];
  total: number;
  /** Every flat that had at least one head skipped, for a pre-issue check. */
  withProblems: { flat_id: string; flat_label: string; reasons: string[] }[];
}

/**
 * Work out a whole society's bills, and surface what did not add up.
 *
 * The `withProblems` list is the reason this returns a structure rather
 * than a number: issuing a run with a dozen flats silently missing
 * their largest charge is the failure worth preventing, and it is
 * invisible in a total.
 */
export function billRun(flats: FlatForBilling[], heads: ChargeHead[]): BillRun {
  const bills = flats.map((f) => billForFlat(f, heads));

  const withProblems = bills
    .map((bill, i) => ({
      flat_id: bill.flat_id,
      flat_label: [flats[i].wing, flats[i].flat_number].filter(Boolean).join("-"),
      reasons: [...new Set(bill.skipped.map((s) => `${s.head_name}: ${s.reason}`))],
    }))
    .filter((f) => f.reasons.length > 0);

  return {
    bills,
    total: rupees(bills.reduce((sum, b) => sum + b.total, 0)),
    withProblems,
  };
}

/**
 * A plain-language summary of how a head is charged, for the admin form.
 */
export function describeCharge(head: ChargeHead): string {
  switch (head.calculation_type) {
    case "fixed":
      return `₹${head.rate} for every flat`;
    case "per_sqft":
      return `₹${head.rate} per sq ft`;
    case "per_unit_type": {
      const entries = Object.entries(head.unit_rates ?? {});
      if (entries.length === 0) return "No rates set yet";
      return entries.map(([unit, rate]) => `${unit} ₹${rate}`).join(" · ");
    }
  }
}
