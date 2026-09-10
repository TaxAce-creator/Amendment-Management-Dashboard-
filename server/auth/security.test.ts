import { describe, expect, it } from "vitest";
import { validateGoogleWorkspaceClaims } from "./claims.js";
import { safeReturnTo, secureStringEqual, sha256 } from "./security.js";

describe("Google Workspace identity validation", () => {
  it("accepts a verified identity from the configured hosted domain", () => {
    expect(
      validateGoogleWorkspaceClaims({
        iss: "https://accounts.google.com",
        sub: "google-subject-1",
        email: "Person@TaxAceBSI.com",
        email_verified: true,
        hd: "taxacebsi.com",
        name: "TaxAce User",
      }),
    ).toEqual({
      issuer: "https://accounts.google.com",
      subject: "google-subject-1",
      email: "person@taxacebsi.com",
      name: "TaxAce User",
    });
  });

  it("rejects a consumer Google account or wrong Workspace domain", () => {
    expect(() =>
      validateGoogleWorkspaceClaims({
        iss: "https://accounts.google.com",
        sub: "1",
        email: "person@gmail.com",
        email_verified: true,
      }),
    ).toThrow(/Workspace domain/);

    expect(() =>
      validateGoogleWorkspaceClaims({
        iss: "https://accounts.google.com",
        sub: "2",
        email: "person@other.example",
        email_verified: true,
        hd: "other.example",
      }),
    ).toThrow(/taxacebsi.com/);
  });

  it("rejects an unverified Workspace email", () => {
    expect(() =>
      validateGoogleWorkspaceClaims({
        iss: "https://accounts.google.com",
        sub: "3",
        email: "person@taxacebsi.com",
        email_verified: false,
        hd: "taxacebsi.com",
      }),
    ).toThrow(/verified/);
  });
});

describe("auth request security helpers", () => {
  it("allows only local return paths", () => {
    expect(safeReturnTo("/amendments/12")).toBe("/amendments/12");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil")).toBe("/");
  });

  it("hashes opaque session material deterministically without storing it raw", () => {
    expect(sha256("token-value")).toHaveLength(64);
    expect(sha256("token-value")).toBe(sha256("token-value"));
    expect(sha256("token-value")).not.toBe("token-value");
  });

  it("compares temporary test access codes using constant-length digests", () => {
    expect(secureStringEqual("temporary-secret", "temporary-secret")).toBe(true);
    expect(secureStringEqual("temporary-secret", "wrong-secret")).toBe(false);
  });
});
