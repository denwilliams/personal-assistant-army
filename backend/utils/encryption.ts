/**
 * Encryption utilities for sensitive data like API keys
 * Uses AES-256-GCM for encryption
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard IV length
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string value
 * @param plaintext The value to encrypt
 * @param secret The encryption key (must be 32 bytes for AES-256)
 * @returns Base64-encoded encrypted value with IV and auth tag
 */
export async function encrypt(plaintext: string, secret: string): Promise<string> {
  // Ensure secret is the right length (32 bytes for AES-256)
  const key = await deriveKey(secret);

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Import key for encryption
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Encrypt the data
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    encoded
  );

  // Combine IV + ciphertext (ciphertext includes auth tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Return base64-encoded result
  return Buffer.from(combined).toString("base64");
}

/**
 * Decrypt an encrypted string value
 * @param encrypted Base64-encoded encrypted value
 * @param secret The encryption key (must be 32 bytes for AES-256)
 * @returns Decrypted plaintext value
 */
export async function decrypt(encrypted: string, secret: string): Promise<string> {
  // Ensure secret is the right length
  const key = await deriveKey(secret);

  // Decode base64
  const combined = Buffer.from(encrypted, "base64");

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  // Import key for decryption
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // Decrypt the data
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    ciphertext
  );

  // Return decoded string
  return new TextDecoder().decode(plaintext);
}

/**
 * Derive a 32-byte key from the secret string using SHA-256
 */
async function deriveKey(secret: string): Promise<ArrayBuffer> {
  const encoded = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return hash;
}
