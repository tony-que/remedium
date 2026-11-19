import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, loadKey, TokenCryptoError } from "@/lib/qbo/crypto";

const key = randomBytes(32);

describe("token encryption", () => {
  it("round-trips", () => {
    const ct = encrypt("secret-refresh-token", "qbo:refresh_token", key);
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("secret-refresh-token");
    expect(decrypt(ct, "qbo:refresh_token", key)).toBe("secret-refresh-token");
  });

  it("uses a fresh IV every time", () => {
    expect(encrypt("same", "p", key)).not.toBe(encrypt("same", "p", key));
  });

  it("refuses a ciphertext moved to another purpose", () => {
    const ct = encrypt("token", "qbo:access_token", key);
    expect(() => decrypt(ct, "qbo:refresh_token", key)).toThrow(TokenCryptoError);
  });

  it("refuses tampered data and the wrong key", () => {
    const ct = encrypt("token", "p", key);
    const parts = ct.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    parts[3] = flipped.toString("base64url");
    expect(() => decrypt(parts.join("."), "p", key)).toThrow(TokenCryptoError);
    expect(() => decrypt(ct, "p", randomBytes(32))).toThrow(TokenCryptoError);
  });

  it("never echoes the ciphertext in errors", () => {
    const ct = encrypt("token", "p", key);
    try {
      decrypt(ct, "other", key);
    } catch (err) {
      expect((err as Error).message).not.toContain(ct);
    }
  });

  it("validates TOKEN_ENC_KEY", () => {
    expect(() => loadKey("")).toThrow(/not set/);
    expect(() => loadKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(loadKey(Buffer.alloc(32, 1).toString("base64"))).toHaveLength(32);
  });
});
