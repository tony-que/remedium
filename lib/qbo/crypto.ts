import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM encryption for QuickBooks tokens at rest.
//
// Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url. The 12-byte IV is
// random per message. A purpose string (e.g. "qbo:refresh_token") is bound in
// as additional authenticated data, so a ciphertext can't be moved into a
// different column and still decrypt.

const VERSION = "v1";
const IV_BYTES = 12;

export class TokenCryptoError extends Error {}

/** Decodes TOKEN_ENC_KEY (base64, 32 bytes). */
export function loadKey(raw = process.env.TOKEN_ENC_KEY): Buffer {
  if (!raw) throw new TokenCryptoError("TOKEN_ENC_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new TokenCryptoError(`TOKEN_ENC_KEY must be 32 bytes of base64 (got ${key.length} bytes).`);
  }
  return key;
}

export function encrypt(plaintext: string, purpose: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string, purpose: string, key: Buffer = loadKey()): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new TokenCryptoError("Unrecognized token ciphertext format.");
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong purpose or tampered data. Never echo the payload.
    throw new TokenCryptoError("Could not decrypt a stored QuickBooks token (wrong TOKEN_ENC_KEY, or the data was altered).");
  }
}
