import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    authenticated: true,
    lastActive: nowSec,
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec)
    .setExpirationTime("24h")
    .sign(SECRET);
}

/**
 * Detailed verification of dashboard auth session.
 * Checks JWT signature/expiry and optional inactivity/idle limit.
 *
 * @param {string} token
 * @param {{ maxIdleSeconds?: number }} [options]
 * @returns {Promise<{ valid: boolean, reason?: "invalid"|"expired"|"idle", payload?: object }>}
 */
export async function verifyDashboardAuthSession(token, { maxIdleSeconds = 0 } = {}) {
  if (!token) return { valid: false, reason: "invalid" };
  try {
    const { payload } = await jwtVerify(token, SECRET);

    if (maxIdleSeconds > 0 && typeof payload.lastActive === "number") {
      const nowSec = Math.floor(Date.now() / 1000);
      const idleTime = nowSec - payload.lastActive;
      if (idleTime > maxIdleSeconds) {
        return { valid: false, reason: "idle", payload };
      }
    }

    return { valid: true, payload };
  } catch (err) {
    const reason = err?.code === "ERR_JWT_EXPIRED" ? "expired" : "invalid";
    return { valid: false, reason };
  }
}

/**
 * Backward-compatible boolean verification.
 */
export async function verifyDashboardAuthToken(token, options = {}) {
  const result = await verifyDashboardAuthSession(token, options);
  return result.valid === true;
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Refreshes the lastActive timestamp of an existing valid token.
 * Retains all custom claims while stamping a fresh lastActive and iat.
 */
export async function refreshDashboardAuthToken(token) {
  const session = await getDashboardAuthSession(token);
  if (!session) return null;

  // Strip standard JWT reserved claims and previous lastActive timestamp
  const { exp, iat, nbf, jti, lastActive, ...customClaims } = session;
  return createDashboardAuthToken(customClaims);
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
