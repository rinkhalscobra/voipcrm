import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function encryptionKey() {
  const key = Buffer.from(process.env.PROVIDER_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32)
    throw new Error(
      "PROVIDER_ENCRYPTION_KEY must contain 32 base64-encoded bytes",
    );
  return key;
}
export function encryptCredential(value: string, accountId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(accountId));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptCredential(value: string, accountId: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Invalid encrypted credential");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  cipher.setAAD(Buffer.from(accountId));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(ciphertext, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
const secretPattern = /api.?key|password|secret|authorization|token|cookie/i;
export function scrubProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubProviderPayload);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretPattern.test(key))
        .map(([key, v]) => [key, scrubProviderPayload(v)]),
    );
  return value;
}
