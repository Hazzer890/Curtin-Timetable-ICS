import { afterEach, describe, expect, it } from "vitest";
import { findSession } from "../src/client";

// JWT with payload {"sub":"12345678"} — signature irrelevant, we only read the claim.
const JWT = `a.${btoa(JSON.stringify({ sub: "12345678" }))}.c`;

function stubStorage(entries: Record<string, string>): void {
  const keys = Object.keys(entries);
  (globalThis as { localStorage?: unknown }).localStorage = {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("findSession", () => {
  it("reads token and id from a __cache_ entry", () => {
    stubStorage({
      "__cache_other": JSON.stringify({ something: 1 }),
      "__cache_session": JSON.stringify({ "elsie-user": { accessToken: JWT, curtinId: "12345678" } }),
    });
    expect(findSession()).toEqual({ token: JWT, id: "12345678" });
  });

  it("accepts .token as well as .accessToken", () => {
    stubStorage({ "__cache_session": JSON.stringify({ "elsie-user": { token: JWT } }) });
    expect(findSession()?.token).toBe(JWT);
  });

  it("falls back to the JWT sub claim when no id field is present", () => {
    stubStorage({ "__cache_session": JSON.stringify({ "elsie-user": { accessToken: JWT } }) });
    expect(findSession()?.id).toBe("12345678");
  });

  it("ignores unparseable and non-cache entries", () => {
    stubStorage({ "__cache_broken": "not json", "elsie-user": JSON.stringify({ accessToken: JWT }) });
    expect(findSession()).toBeNull();
  });

  it("returns null when there is no session", () => {
    stubStorage({});
    expect(findSession()).toBeNull();
  });
});
