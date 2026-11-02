export type DuitkuEnvironment = "sandbox" | "production";

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function duitkuEnvironment(): DuitkuEnvironment {
  const value = requiredEnv("DUITKU_ENVIRONMENT");
  if (value !== "sandbox" && value !== "production") {
    throw new Error("DUITKU_ENVIRONMENT must be sandbox or production");
  }
  return value;
}

export function duitkuEndpoint(environment: DuitkuEnvironment): string {
  return environment === "sandbox"
    ? "https://api-sandbox.duitku.com/api/merchant/createInvoice"
    : "https://api-prod.duitku.com/api/merchant/createInvoice";
}

export function duitkuTransactionStatusEndpoint(
  environment: DuitkuEnvironment,
): string {
  return environment === "sandbox"
    ? "https://sandbox.duitku.com/webapi/api/merchant/transactionStatus"
    : "https://passport.duitku.com/webapi/api/merchant/transactionStatus";
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isVerifiedTransactionStatus(
  value: unknown,
  expected: {
    merchantOrderId: string;
    reference: string;
    amount: number;
  },
): value is Record<string, unknown> {
  const response = asRecord(value);
  const amountText = typeof response.amount === "string"
    ? response.amount
    : typeof response.amount === "number"
    ? String(response.amount)
    : "";
  const amount = /^\d+$/.test(amountText) ? Number(amountText) : NaN;

  return safeText(response.merchantOrderId, 100) ===
      expected.merchantOrderId &&
    safeText(response.reference, 100) === expected.reference &&
    Number.isSafeInteger(amount) &&
    amount === expected.amount &&
    ["00", "01", "02"].includes(safeText(response.statusCode, 10) ?? "");
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function safeText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}
