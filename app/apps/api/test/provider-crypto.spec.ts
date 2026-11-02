import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  providerAad,
  secretFingerprint,
  secretHint,
} from "../src/modules/admin/provider-crypto";

describe("provider credential encryption", () => {
  it("round-trips a key and never stores the plaintext in the ciphertext", () => {
    const secret = "sk-test-secret-12345678";
    const encrypted = encryptSecret(secret, providerAad("1001", 1));
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(encrypted.ciphertext.split(".")).toHaveLength(3);
    expect(decryptSecret(encrypted.ciphertext, providerAad("1001", 1))).toBe(secret);
  });

  it("rejects a ciphertext moved to another provider AAD", () => {
    const encrypted = encryptSecret("sk-another-12345678", providerAad("1001", 1));
    expect(() => decryptSecret(encrypted.ciphertext, providerAad("1002", 1))).toThrow(/decrypt failed/);
  });

  it("masks short and long keys without exposing the full value", () => {
    expect(secretHint("sk-test-secret-12345678")).toBe("****5678");
    expect(secretHint("abcd")).toBe("****");
    expect(secretHint("abcde")).toBe("****bcde");
  });

  it("keeps a stable non-reversible fingerprint", () => {
    const a = secretFingerprint("sk-test-secret-12345678");
    expect(a).toHaveLength(8);
    expect(a).toBe(secretFingerprint("sk-test-secret-12345678"));
    expect(a).not.toBe(secretFingerprint("sk-test-secret-87654321"));
  });
});
