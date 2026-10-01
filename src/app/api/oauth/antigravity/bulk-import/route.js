import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { createProviderConnection, getProviderConnectionsByProvider } from "@/models";

/**
 * POST /api/oauth/antigravity/bulk-import
 *
 * Accepts { accounts: [{ email, password }] } and delegates each account
 * to the ag-injector sidecar container for headless Google OAuth login,
 * token exchange, project discovery, and SQLite injection.
 *
 * Protected by dashboard auth session.
 * Passwords are NEVER stored or logged — they are forwarded to the sidecar
 * over the internal Docker network and discarded immediately.
 */

const INJECTOR_HOST = process.env.AG_INJECTOR_HOST || "ag-injector";
const INJECTOR_PORT = parseInt(process.env.AG_INJECTOR_PORT || "8125", 10);

export async function POST(request) {
  // Auth check
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(
    cookieStore.get("auth_token")?.value
  );
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err.message}` },
      { status: 400 }
    );
  }

  const accounts = body?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json(
      { error: "No accounts provided. Expected { accounts: [{ email, password }] }" },
      { status: 400 }
    );
  }

  // Validate each account has email + password
  const valid = [];
  const invalid = [];
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const email = String(acc?.email || "").trim();
    const password = String(acc?.password || "").trim();
    if (!email || !password) {
      invalid.push({ index: i, email: email || "(empty)", ok: false, error: "Missing email or password" });
    } else {
      valid.push({ email, password });
    }
  }

  if (valid.length === 0) {
    return NextResponse.json({
      total: accounts.length,
      success: 0,
      failed: invalid.length,
      results: invalid,
    });
  }

  // Forward to sidecar injector
  try {
    const http = await import("node:http");

    const injectorResult = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        accounts: valid,
        retries: 1,
      });

      const req = http.request(
        {
          hostname: INJECTOR_HOST,
          port: INJECTOR_PORT,
          path: "/inject",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: valid.length * 120_000 + 30_000, // 2min per account + 30s buffer
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Injector returned invalid JSON: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on("error", (e) => reject(new Error(`Injector connection failed: ${e.message}`)));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Injector request timed out"));
      });

      req.write(payload);
      req.end();
    });

    // Merge invalid items into results
    const allResults = [...invalid, ...(injectorResult.results || [])];

    return NextResponse.json({
      total: accounts.length,
      success: injectorResult.success || 0,
      failed: (injectorResult.failed || 0) + invalid.length,
      results: allResults,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Injector error: ${err.message}` },
      { status: 502 }
    );
  }
}
