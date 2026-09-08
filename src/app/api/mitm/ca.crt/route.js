import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = process.env.DATA_DIR
  || (process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router"));

const CERT_PATH = path.join(DATA_DIR, "mitm", "rootCA.crt");

export async function GET() {
  try {
    if (!fs.existsSync(CERT_PATH)) {
      return new NextResponse("Root CA certificate not generated yet", { status: 404 });
    }
    const cert = fs.readFileSync(CERT_PATH);
    return new NextResponse(cert, {
      headers: {
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'inline; filename="9router-root-ca.crt"',
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return new NextResponse(`Failed to read certificate: ${error.message}`, { status: 500 });
  }
}
