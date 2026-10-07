import { describe, it, expect } from "vitest";
import {
  parseDelimited, detectDelimiter, normaliseHeader, normalisePhone, normaliseDate,
  normaliseIdType, normaliseGender, validateIdNumber, maskIdNumber,
  parseStaffSheet, buildTemplateCsv, normaliseDevicePin,
} from "./staffImport";

describe("parseDelimited", () => {
  it("parses a plain CSV", () => {
    expect(parseDelimited("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas inside quoted fields — the whole reason for this parser", () => {
    const rows = parseDelimited('name,address\nRamesh,"12, MG Road, Pune"');
    expect(rows[1]).toEqual(["Ramesh", "12, MG Road, Pune"]);
  });

  it("handles escaped quotes", () => {
    const rows = parseDelimited('name\n"He said ""hi"""');
    expect(rows[1][0]).toBe('He said "hi"');
  });

  it("handles newlines inside quoted fields", () => {
    const rows = parseDelimited('name,address\nA,"Line1\nLine2"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("Line1\nLine2");
  });

  it("strips the Excel BOM so the first header is usable", () => {
    expect(normaliseHeader(parseDelimited("\uFEFFname,phone\nA,1")[0][0])).toBe("name");
  });

  it("drops blank lines", () => {
    expect(parseDelimited("a,b\n\n1,2\n\n")).toHaveLength(2);
  });

  it("handles CRLF line endings", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("detectDelimiter", () => {
  it.each([
    ["name,phone\nA,1", ","],
    ["name\tphone\nA\t1", "\t"],
    ["name;phone\nA;1", ";"],
  ])("detects the delimiter in %j", (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });
});

describe("normalisePhone", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["098765-43210", "9876543210"],
    ["91 9876543210", "9876543210"],
  ])("normalises %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it("rejects short numbers", () => {
    expect(normalisePhone("12345")).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(normalisePhone("")).toBe(null);
  });
});

describe("normaliseDate", () => {
  it.each([
    ["15/08/1985", "1985-08-15"],
    ["15-08-1985", "1985-08-15"],
    ["1985-08-15", "1985-08-15"],
    ["5/8/1985", "1985-08-05"],
  ])("parses %s", (input, expected) => {
    expect(normaliseDate(input)).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(normaliseDate("31/02/1990")).toBe(null);
  });

  it("rejects future dates", () => {
    expect(normaliseDate("01/01/2099")).toBe(null);
  });

  it("rejects unparseable text", () => {
    expect(normaliseDate("last tuesday")).toBe(null);
  });
});

describe("ID handling", () => {
  it.each([
    ["Aadhaar Card", "aadhaar"], ["aadhar", "aadhaar"], ["ADHAR", "aadhaar"],
    ["PAN Card", "pan"], ["voter id", "voter_id"], ["EPIC", "voter_id"],
    ["Driving Licence", "driving_license"], ["DL", "driving_license"],
    ["Ration Card", "ration_card"], ["Passport", "passport"],
  ])("maps %s to the right type", (input, expected) => {
    expect(normaliseIdType(input)).toBe(expected);
  });

  it("rejects an unknown document type", () => {
    expect(normaliseIdType("library card")).toBe(null);
  });

  it("validates Aadhaar as 12 digits", () => {
    expect(validateIdNumber("aadhaar", "1234 1234 1234")).toBe(null);
    expect(validateIdNumber("aadhaar", "12345")).toMatch(/12 digits/);
  });

  it("validates PAN shape", () => {
    expect(validateIdNumber("pan", "ABCDE1234F")).toBe(null);
    expect(validateIdNumber("pan", "ABC1234")).toMatch(/ABCDE1234F/);
  });

  it("validates passport shape", () => {
    expect(validateIdNumber("passport", "A1234567")).toBe(null);
    expect(validateIdNumber("passport", "12345678")).toMatch(/letter/);
  });

  it("masks Aadhaar so only the last four digits are stored", () => {
    expect(maskIdNumber("aadhaar", "1234 1234 5678")).toBe("XXXXXXXX5678");
  });

  it("leaves other document numbers unmasked but upper-cased", () => {
    expect(maskIdNumber("pan", "abcde1234f")).toBe("ABCDE1234F");
  });
});

describe("normaliseGender", () => {
  it.each([["M", "male"], ["female", "female"], ["O", "other"], ["", "undisclosed"]])(
    "maps %j", (input, expected) => expect(normaliseGender(input)).toBe(expected));

  it("rejects nonsense", () => {
    expect(normaliseGender("yes")).toBe(null);
  });
});

describe("parseStaffSheet", () => {
  const opts = { defaultRoleType: "Helper" };

  it("parses a well-formed sheet", () => {
    const csv = [
      "name,phone,staff_type,gender,dob,address,id_type,id_number",
      'Ramesh Kumar,9876543210,Security,male,15/08/1985,"12, MG Road, Pune",aadhaar,123412341234',
    ].join("\n");
    const out = parseStaffSheet(csv, opts);
    expect(out.errors).toEqual([]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      name: "Ramesh Kumar",
      phone: "9876543210",
      role_type: "Security",
      gender: "male",
      date_of_birth: "1985-08-15",
      address: "12, MG Road, Pune",
      id_type: "aadhaar",
      id_number: "XXXXXXXX1234",
    });
  });

  it("accepts alternative header spellings", () => {
    const csv = "Full Name,Mobile Number,Designation\nSita,+91 98765 43210,Maid";
    const out = parseStaffSheet(csv, opts);
    expect(out.errors).toEqual([]);
    expect(out.rows[0]).toMatchObject({ name: "Sita", phone: "9876543210", role_type: "Maid" });
  });

  it("falls back to the default role when the column is blank", () => {
    const out = parseStaffSheet("name,staff_type\nAsha,", opts);
    expect(out.rows[0].role_type).toBe("Helper");
  });

  it("reports the spreadsheet line number on a bad row", () => {
    const csv = "name,phone\nGood,9876543210\nBad,123";
    const out = parseStaffSheet(csv, opts);
    expect(out.rows).toHaveLength(1);
    expect(out.errors[0].line).toBe(3);
    expect(out.errors[0].message).toMatch(/phone/);
  });

  it("keeps good rows when other rows fail", () => {
    const csv = "name,phone\nGood,9876543210\n,999\nAlso Good,9123456780";
    const out = parseStaffSheet(csv, opts);
    expect(out.rows.map(r => r.name)).toEqual(["Good", "Also Good"]);
    expect(out.errors).toHaveLength(1);
  });

  it("rejects a file with no name column", () => {
    const out = parseStaffSheet("phone,address\n1,2", opts);
    expect(out.rows).toEqual([]);
    expect(out.errors[0].message).toMatch(/name/);
  });

  it("surfaces unrecognised columns instead of silently dropping them", () => {
    const out = parseStaffSheet("name,shoe_size\nA,9", opts);
    expect(out.ignoredColumns).toEqual(["shoe_size"]);
  });

  it("catches a duplicate ID number inside the same file", () => {
    const csv = [
      "name,id_type,id_number",
      "A,aadhaar,123412341234",
      "B,aadhaar,1234 1234 1234",
    ].join("\n");
    const out = parseStaffSheet(csv, opts);
    expect(out.rows).toHaveLength(1);
    expect(out.errors[0].message).toMatch(/Duplicate/);
  });

  it("rejects an ID number with no ID type", () => {
    const out = parseStaffSheet("name,id_number\nA,123412341234", opts);
    expect(out.errors[0].message).toMatch(/without an ID type/);
  });

  it("rejects an ID type with no number", () => {
    const out = parseStaffSheet("name,id_type\nA,aadhaar", opts);
    expect(out.errors[0].message).toMatch(/without an ID number/);
  });

  it("can keep Aadhaar unmasked when explicitly asked", () => {
    const out = parseStaffSheet("name,id_type,id_number\nA,aadhaar,123412341234",
      { ...opts, maskAadhaar: false });
    expect(out.rows[0].id_number).toBe("123412341234");
  });

  it("handles a TSV export", () => {
    const out = parseStaffSheet("name\tphone\nRaj\t9876543210", opts);
    expect(out.rows[0]).toMatchObject({ name: "Raj", phone: "9876543210" });
  });

  it("round-trips its own template", () => {
    for (const kind of ["staff", "house_help"] as const) {
      const out = parseStaffSheet(buildTemplateCsv(kind), opts);
      expect(out.errors).toEqual([]);
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].address).toContain(",");
    }
  });
});

describe("device PIN (biometric terminal user id)", () => {
  const opts = { defaultRoleType: "Other" };

  it("imports a device PIN alongside the rest of the profile", () => {
    const out = parseStaffSheet("name,device_pin\nRamesh,1", opts);
    expect(out.errors).toEqual([]);
    expect(out.rows[0].device_pin).toBe("1");
  });

  it("accepts the headings people actually type", () => {
    for (const h of ["pin", "user_id", "User ID", "biometric_id", "Fingerprint ID", "machine_id"]) {
      const out = parseStaffSheet(`name,${h}\nRamesh,7`, opts);
      expect(out.errors).toEqual([]);
      expect(out.rows[0].device_pin).toBe("7");
    }
  });

  it("preserves leading zeros, since the device echoes the PIN verbatim", () => {
    expect(parseStaffSheet("name,device_pin\nRamesh,007", opts).rows[0].device_pin).toBe("007");
  });

  it("leaves the PIN null when the column is absent", () => {
    expect(parseStaffSheet("name\nRamesh", opts).rows[0].device_pin).toBe(null);
  });

  it("leaves the PIN null when the cell is blank", () => {
    expect(parseStaffSheet("name,device_pin\nRamesh,", opts).rows[0].device_pin).toBe(null);
  });

  it("rejects a non-numeric PIN", () => {
    const out = parseStaffSheet("name,device_pin\nRamesh,ABC", opts);
    expect(out.rows).toHaveLength(0);
    expect(out.errors[0].message).toMatch(/digits only/);
  });

  it("catches two people sharing a PIN in the same file", () => {
    const out = parseStaffSheet("name,device_pin\nA,1\nB,1", opts);
    expect(out.rows.map(r => r.name)).toEqual(["A"]);
    expect(out.errors[0].message).toMatch(/Duplicate device PIN/);
  });

  it("still allows many people with no PIN at all", () => {
    const out = parseStaffSheet("name,device_pin\nA,\nB,\nC,3", opts);
    expect(out.errors).toEqual([]);
    expect(out.rows.map(r => r.device_pin)).toEqual([null, null, "3"]);
  });

  it("includes device_pin in the downloadable template", () => {
    for (const kind of ["staff", "house_help"] as const) {
      const csv = buildTemplateCsv(kind);
      expect(csv.split("\n")[0]).toContain("device_pin");
      const out = parseStaffSheet(csv, opts);
      expect(out.errors).toEqual([]);
      expect(out.rows[0].device_pin).toBeTruthy();
    }
  });
});

describe("normaliseDevicePin", () => {
  it.each([["1", "1"], ["007", "007"], [" 42 ", "42"], ["1234567890", "1234567890"]])(
    "accepts %j", (input, expected) => expect(normaliseDevicePin(input)).toBe(expected));

  it.each(["", "abc", "1a", "-1", "1.5", "12345678901"])(
    "rejects %j", (input) => expect(normaliseDevicePin(input)).toBe(null));
});
