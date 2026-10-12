import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { validateIdNumber, maskIdNumber, type GovIdType, type Gender } from "@/lib/staffImport";

/**
 * The profile fields shared by society staff and house helps: gender,
 * DOB, address, government ID and emergency contact. One component so
 * the two managers cannot drift apart, and so the ID validation rules
 * are identical to the ones the spreadsheet importer applies.
 */

export interface ProfileFieldValues {
  gender: string;
  date_of_birth: string;
  address: string;
  id_type: string;
  id_number: string;
  emergency_contact: string;
  emergency_phone: string;
  /** User ID as enrolled on the biometric terminal. */
  device_pin: string;
  /** 'day' or 'night'. Decides which attendance day a punch belongs to. */
  shift: string;
}

export const emptyProfileFields = (): ProfileFieldValues => ({
  gender: "", date_of_birth: "", address: "",
  id_type: "", id_number: "", emergency_contact: "", emergency_phone: "",
  device_pin: "", shift: "day",
});

export const ID_TYPE_OPTIONS: { value: GovIdType; label: string }[] = [
  { value: "aadhaar", label: "Aadhaar Card" },
  { value: "passport", label: "Passport" },
  { value: "pan", label: "PAN Card" },
  { value: "voter_id", label: "Voter ID" },
  { value: "driving_license", label: "Driving License" },
  { value: "ration_card", label: "Ration Card" },
];

/**
 * A night shift's attendance day runs 09:00 to 09:00 rather than
 * midnight to midnight, so a shift worked 22:00 to 06:00 is reported
 * under the evening it started and its entry and exit stay on one row.
 * The database enforces the same two values (public.staff_shift).
 */
export const SHIFT_OPTIONS: { value: "day" | "night"; label: string; hint: string }[] = [
  { value: "day", label: "Day shift", hint: "Attendance day runs midnight to midnight" },
  { value: "night", label: "Night shift", hint: "Attendance day runs 9 AM to 9 AM" },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "undisclosed", label: "Prefer not to say" },
];

/**
 * An Aadhaar number already stored in masked form, e.g. XXXXXXXX1234.
 *
 * This matters when EDITING an existing record: the stored value is the
 * masked one, so re-validating it as a raw 12-digit Aadhaar would reject
 * a record the admin never touched.
 */
export function isMaskedIdNumber(value: string): boolean {
  return /^X{4,}\d{4}$/i.test(value.replace(/\s+/g, ""));
}

/** Shared validation so the dialog and the importer agree. */
export function validateProfileFields(v: ProfileFieldValues): string | null {
  if (v.id_number && !v.id_type) return "Select an ID type for the ID number entered";
  if (v.id_type && !v.id_number) return "Enter the ID number for the selected ID type";
  if (v.id_type && v.id_number && !isMaskedIdNumber(v.id_number)) {
    const problem = validateIdNumber(v.id_type as GovIdType, v.id_number);
    if (problem) return problem;
  }
  if (v.emergency_phone && v.emergency_phone.replace(/\D/g, "").length < 10) {
    return "Emergency phone must be at least 10 digits";
  }
  if (v.device_pin && !/^\d{1,10}$/.test(v.device_pin.trim())) {
    return "Fingerprint ID must be digits only";
  }
  if (v.shift && v.shift !== "day" && v.shift !== "night") {
    return "Shift must be either day or night";
  }
  return null;
}

/**
 * Shape the values for a Supabase insert or update.
 *
 * Aadhaar is masked to its last four digits here. The form tells the
 * admin "the full Aadhaar number is never saved", and previously that
 * was not true on this path — only the spreadsheet importer masked it,
 * so anyone added or edited through the dialog had their full 12 digits
 * written to the database. maskIdNumber is the same function the
 * importer uses, and it leaves an already-masked value untouched.
 */
export function profileFieldsToRow(v: ProfileFieldValues) {
  const rawId = v.id_number.replace(/\s+/g, "");
  return {
    gender: v.gender || null,
    date_of_birth: v.date_of_birth || null,
    address: v.address.trim() || null,
    id_type: v.id_type || null,
    id_number: rawId
      ? (isMaskedIdNumber(rawId)
          ? rawId.toUpperCase()
          : maskIdNumber(v.id_type as GovIdType, rawId))
      : null,
    emergency_contact: v.emergency_contact.trim() || null,
    emergency_phone: v.emergency_phone.replace(/\D/g, "") || null,
    device_pin: v.device_pin.trim() || null,
    // Not nullable in the database, so an empty form value becomes the
    // 'day' default rather than a null that would be rejected.
    shift: v.shift === "night" ? "night" : "day",
  };
}

/**
 * Load a database row back into form values, for the edit dialog.
 * Nulls become empty strings, which is what the inputs expect.
 */
export function profileFieldsFromRow(row: Record<string, unknown>): ProfileFieldValues {
  const s = (k: string) => (row[k] == null ? "" : String(row[k]));
  return {
    gender: s("gender"),
    date_of_birth: s("date_of_birth").slice(0, 10),
    address: s("address"),
    id_type: s("id_type"),
    id_number: s("id_number"),
    emergency_contact: s("emergency_contact"),
    emergency_phone: s("emergency_phone"),
    device_pin: s("device_pin"),
    shift: s("shift") === "night" ? "night" : "day",
  };
}

interface Props {
  values: ProfileFieldValues;
  onChange: (next: ProfileFieldValues) => void;
}

const StaffProfileFields = ({ values, onChange }: Props) => {
  const set = (patch: Partial<ProfileFieldValues>) => onChange({ ...values, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <Select value={values.gender} onValueChange={(gender) => set({ gender })}>
            <SelectTrigger className="touch-target"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((g) => (
                <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-dob">Date of birth</Label>
          <Input
            id="sp-dob"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={values.date_of_birth}
            onChange={(e) => set({ date_of_birth: e.target.value })}
            className="touch-target"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sp-address">Address</Label>
        <Input
          id="sp-address"
          placeholder="House / street / area"
          value={values.address}
          onChange={(e) => set({ address: e.target.value })}
          className="touch-target"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>ID type</Label>
          <Select value={values.id_type} onValueChange={(id_type) => set({ id_type })}>
            <SelectTrigger className="touch-target"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {ID_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-idnum">ID number</Label>
          <Input
            id="sp-idnum"
            placeholder={values.id_type === "aadhaar" ? "12 digits" : "Document number"}
            value={values.id_number}
            onChange={(e) => set({ id_number: e.target.value })}
            className="touch-target"
          />
        </div>
      </div>
      {values.id_type === "aadhaar" && (
        <p className="text-xs text-muted-foreground">
          Only the last 4 digits are stored. The full Aadhaar number is never saved.
        </p>
      )}

      <div className="space-y-1.5">
        <Label>Shift</Label>
        <Select value={values.shift || "day"} onValueChange={(shift) => set({ shift })}>
          <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHIFT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {SHIFT_OPTIONS.find((o) => o.value === (values.shift || "day"))?.hint}
          {(values.shift || "day") === "night"
            ? " \u2014 an overnight shift stays on one row, under the date it began."
            : ""}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sp-pin">Fingerprint ID (biometric terminal)</Label>
        <Input
          id="sp-pin"
          inputMode="numeric"
          placeholder="User ID as enrolled on the device, e.g. 1"
          value={values.device_pin}
          onChange={(e) => set({ device_pin: e.target.value })}
          className="touch-target"
        />
        <p className="text-xs text-muted-foreground">
          Leave blank if they do not use the fingerprint terminal. It can be
          assigned later from Admin &rarr; Fingerprint IDs.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sp-ec">Emergency contact</Label>
          <Input
            id="sp-ec"
            placeholder="Name"
            value={values.emergency_contact}
            onChange={(e) => set({ emergency_contact: e.target.value })}
            className="touch-target"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-ep">Emergency phone</Label>
          <Input
            id="sp-ep"
            inputMode="numeric"
            placeholder="10-digit number"
            value={values.emergency_phone}
            onChange={(e) => set({ emergency_phone: e.target.value })}
            className="touch-target"
          />
        </div>
      </div>
    </div>
  );
};

export default StaffProfileFields;
