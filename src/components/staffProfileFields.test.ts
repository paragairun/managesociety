import { describe, it, expect } from "vitest";
import {
  validateProfileFields, profileFieldsToRow, profileFieldsFromRow,
  isMaskedIdNumber, emptyProfileFields,
} from "./StaffProfileFields";

const f = (over = {}) => ({ ...emptyProfileFields(), ...over });

describe("Aadhaar is actually masked before storage", () => {
  it("masks a full Aadhaar entered in the dialog", () => {
    // The form promises "the full Aadhaar number is never saved".
    // Before this fix the dialog stored all 12 digits.
    const row = profileFieldsToRow(f({ id_type: "aadhaar", id_number: "1234 5678 9012" }));
    expect(row.id_number).toBe("XXXXXXXX9012");
    expect(row.id_number).not.toContain("1234 5678");
  });

  it("leaves an already-masked value untouched on re-save", () => {
    const row = profileFieldsToRow(f({ id_type: "aadhaar", id_number: "XXXXXXXX9012" }));
    expect(row.id_number).toBe("XXXXXXXX9012");
  });

  it("does not mask other document types", () => {
    expect(profileFieldsToRow(f({ id_type: "pan", id_number: "abcde1234f" })).id_number).toBe("ABCDE1234F");
  });

  it("stores null when no ID is given", () => {
    expect(profileFieldsToRow(f()).id_number).toBe(null);
  });
});

describe("editing a record with a masked Aadhaar", () => {
  it("passes validation instead of rejecting the stored value", () => {
    // Re-validating XXXXXXXX9012 as a 12-digit Aadhaar would fail, so an
    // admin could not save any edit to such a record.
    expect(validateProfileFields(f({ id_type: "aadhaar", id_number: "XXXXXXXX9012" }))).toBe(null);
  });

  it("still rejects a genuinely malformed Aadhaar", () => {
    expect(validateProfileFields(f({ id_type: "aadhaar", id_number: "12345" }))).toMatch(/12 digits/);
  });

  it("recognises masked values, and only those", () => {
    expect(isMaskedIdNumber("XXXXXXXX9012")).toBe(true);
    expect(isMaskedIdNumber("123456789012")).toBe(false);
    expect(isMaskedIdNumber("ABCDE1234F")).toBe(false);
  });
});

describe("loading a database row into the edit form", () => {
  it("maps every field and turns nulls into empty strings", () => {
    const v = profileFieldsFromRow({
      gender: "male", date_of_birth: "1985-08-15", address: "12, MG Road",
      id_type: "aadhaar", id_number: "XXXXXXXX9012",
      emergency_contact: null, emergency_phone: null, device_pin: "14",
    });
    expect(v).toEqual({
      gender: "male", date_of_birth: "1985-08-15", address: "12, MG Road",
      id_type: "aadhaar", id_number: "XXXXXXXX9012",
      emergency_contact: "", emergency_phone: "", device_pin: "14",
    });
  });

  it("trims a timestamp down to the date the input expects", () => {
    expect(profileFieldsFromRow({ date_of_birth: "1985-08-15T00:00:00+00:00" }).date_of_birth)
      .toBe("1985-08-15");
  });

  it("survives a row with nothing in it", () => {
    expect(profileFieldsFromRow({})).toEqual(emptyProfileFields());
  });

  it("round-trips: row -> form -> row is stable", () => {
    const original = {
      gender: "female", date_of_birth: "1990-03-02", address: "Flat 4",
      id_type: "voter_id", id_number: "ABC1234567",
      emergency_contact: "Ravi", emergency_phone: "9823456781", device_pin: "7",
    };
    expect(profileFieldsToRow(profileFieldsFromRow(original))).toEqual(original);
  });
});

describe("other validation still holds", () => {
  it("rejects an ID number with no type", () => {
    expect(validateProfileFields(f({ id_number: "123" }))).toMatch(/Select an ID type/);
  });
  it("rejects a non-numeric fingerprint ID", () => {
    expect(validateProfileFields(f({ device_pin: "abc" }))).toMatch(/digits only/);
  });
  it("accepts a fully empty profile", () => {
    expect(validateProfileFields(f())).toBe(null);
  });
});
