/**
 * Resolving one society without being able to list them.
 *
 * The bug these exist for: `societies` was readable by anyone holding
 * the publishable key, so the login picker, the registration form and
 * the visitor form each pulled down the entire customer list — names,
 * slugs, cities — and showed it to unauthenticated strangers. The
 * table is now closed to anon and this helper is the only way in.
 *
 * What matters here is the shape of the REQUEST as much as the answer:
 * if a caller can ever reach the server without a handle, or coax more
 * than one row back, the listing is reopened at a different address.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();

// The mock's rpc is a REAL method, not an arrow, and it checks its
// receiver. supabase-js's rpc() reaches for `this.rest`, so pulling the
// method off the client into a bare variable makes it throw
// "Cannot read properties of undefined (reading 'rest')" before any
// request leaves the browser. An arrow-function mock happily accepts a
// detached call and hides that entirely — which is exactly what
// happened: the suite was green and every society link was broken.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    __isClient: true,
    rest: {},
    rpc(this: { __isClient?: boolean } | undefined, ...args: unknown[]) {
      if (!this?.__isClient) {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      }
      return rpc(...args);
    },
  },
}));

const { resolveSociety } = await import("./societyLookup");

const TRIUMPH = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Triumph Towers CHSL",
  slug: "triumph-towers-chsl",
  city: "Mumbai",
  state: "MH",
};

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("resolving by a handle the caller already has", () => {
  it("resolves a slug and asks only for that slug", async () => {
    rpc.mockResolvedValue({ data: [TRIUMPH], error: null });

    const found = await resolveSociety({ slug: "triumph-towers-chsl" });

    expect(found).toEqual(TRIUMPH);
    expect(rpc).toHaveBeenCalledWith("society_public", {
      _slug: "triumph-towers-chsl",
      _id: null,
    });
  });

  it("resolves an id, for the ?s= handle in gate QR codes", async () => {
    rpc.mockResolvedValue({ data: [TRIUMPH], error: null });

    await resolveSociety({ id: TRIUMPH.id });

    expect(rpc).toHaveBeenCalledWith("society_public", { _slug: null, _id: TRIUMPH.id });
  });

  it("trims whitespace off a handle pasted from a message", async () => {
    rpc.mockResolvedValue({ data: [TRIUMPH], error: null });

    await resolveSociety({ slug: "  triumph-towers-chsl  " });

    expect(rpc).toHaveBeenCalledWith("society_public", {
      _slug: "triumph-towers-chsl",
      _id: null,
    });
  });

  it("returns only the first row even if the server ever sent more", async () => {
    // The function has LIMIT 1 inside it, so this should not happen.
    // Belt and braces: the UI must never render a chooser.
    rpc.mockResolvedValue({ data: [TRIUMPH, { ...TRIUMPH, name: "Other" }], error: null });

    const found = await resolveSociety({ slug: "triumph-towers-chsl" });

    expect(found).toEqual(TRIUMPH);
  });
});

describe("no handle means no request at all", () => {
  it.each([
    ["nothing", {}],
    ["empty strings", { slug: "", id: "" }],
    ["whitespace only", { slug: "   " }],
    ["nulls", { slug: null, id: null }],
    ["undefined", { slug: undefined, id: undefined }],
  ])("%s returns null without calling the server", async (_label, handle) => {
    const found = await resolveSociety(handle);

    expect(found).toBeNull();
    // The important half. A request with both arguments null would be
    // harmless today because the SQL's WHERE is false, but the client
    // should not be probing at all with nothing to look up.
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("failures are indistinguishable from a miss", () => {
  it("returns null for an unknown handle", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await resolveSociety({ slug: "no-such-society" })).toBeNull();
  });

  it("returns null when the server errors, rather than throwing into the page", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await resolveSociety({ slug: "triumph-towers-chsl" })).toBeNull();
  });

  it("returns null when data comes back null with no error", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await resolveSociety({ slug: "triumph-towers-chsl" })).toBeNull();
  });

  it("settles instead of hanging when the call rejects", async () => {
    // A rejected promise used to skip the .then that clears the page's
    // `looking` flag, leaving a permanent loading skeleton.
    rpc.mockRejectedValue(new Error("network down"));
    await expect(resolveSociety({ slug: "triumph-towers-chsl" })).resolves.toBeNull();
  });

  it("settles when the client throws synchronously", async () => {
    rpc.mockImplementation(() => { throw new TypeError("boom"); });
    await expect(resolveSociety({ slug: "triumph-towers-chsl" })).resolves.toBeNull();
  });

  it("gives a suspended society the same answer as a missing one", async () => {
    // The SQL filters status='active' server-side, so the client sees
    // an empty result either way. Nothing here should leak the
    // difference — that would be an existence oracle.
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await resolveSociety({ slug: "dormant-heights" })).toBeNull();
  });
});
