/**
 * Google Service Account authentication using JWT (RS256).
 * Uses Web Crypto API (built into Bun) - no external dependencies.
 *
 * Service accounts authenticate by:
 * 1. Creating a JWT signed with the service account's private key
 * 2. Exchanging the JWT for an access token via Google's token endpoint
 * 3. Using the access token for API calls
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_SECONDS = 3600; // 1 hour

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// In-memory token cache keyed by client_email
const tokenCache = new Map<string, CachedToken>();

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

/**
 * Import a PEM-encoded RSA private key for signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and decode base64
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Create a signed JWT for Google service account authentication
 */
async function createSignedJwt(
  serviceAccount: ServiceAccountKey,
  scopes: string[]
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: serviceAccount.private_key_id,
  };

  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: TOKEN_URL,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    scope: scopes.join(" "),
  };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Parse and validate a service account key JSON string.
 */
export function parseServiceAccountKey(jsonString: string): ServiceAccountKey {
  const key = JSON.parse(jsonString);
  if (key.type !== "service_account") {
    throw new Error("Invalid service account key: type must be 'service_account'");
  }
  if (!key.private_key || !key.client_email) {
    throw new Error("Invalid service account key: missing private_key or client_email");
  }
  return key;
}

/**
 * Get an access token for Google APIs using a service account.
 * Tokens are cached and reused until they expire.
 */
export async function getAccessToken(
  serviceAccountJson: string,
  scopes: string[]
): Promise<string> {
  const serviceAccount = parseServiceAccountKey(serviceAccountJson);

  // Check cache
  const cached = tokenCache.get(serviceAccount.client_email);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  // Create and exchange JWT
  const jwt = await createSignedJwt(serviceAccount, scopes);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const accessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || TOKEN_LIFETIME_SECONDS;

  // Cache the token
  tokenCache.set(serviceAccount.client_email, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return accessToken;
}
