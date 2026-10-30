import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A checkbox, including the indeterminate state.
 *
 * Indeterminate is what a "select all" header shows when some but not
 * all rows are ticked. Without the styling below, Radix still reports
 * the state but the box renders empty and unfilled — identical to
 * unchecked — so a header checkbox would read "nothing selected" while
 * twelve rows were in fact selected. On a screen where the next button
 * applies a charge to the selection, that is not a cosmetic problem.
 *
 * Purely additive: nothing passed "indeterminate" before this, so no
 * existing checkbox changes appearance.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // An explicit radius, not rounded-sm. The shadcn radius scale is
      // derived from --radius (12px here), which makes "sm" 8px — a
      // full circle on a 16px box, so every checkbox in the app read
      // as a radio button, meaning "pick one". The opposite of what a
      // checkbox is for.
      "peer h-4 w-4 shrink-0 rounded-[3px] border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      {/* Radix renders the indicator for both states, so the icon is
          chosen here. A dash rather than a tick, because a tick in a
          half-selected header is the same lie in a different shape. */}
      {props.checked === "indeterminate"
        ? <Minus className="h-4 w-4" />
        : <Check className="h-4 w-4" />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
