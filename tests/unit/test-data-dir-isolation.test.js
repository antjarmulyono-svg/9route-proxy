// Guard: the test harness must never write into the user's real DB.
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";

const ISOLATED = !process.env.RUN_REAL && !process.env.EXPECT_REAL_DATA_DIR;

describe.skipIf(!ISOLATED)("test DATA_DIR isolation", () => {
  it("points DATA_DIR at a temp dir, not ~/.9router", () => {
    const dir = process.env.DATA_DIR;
    expect(dir).toBeTruthy();
    const home = path.join(os.homedir(), ".9router");
    expect(path.resolve(dir)).not.toBe(path.resolve(home));
    expect(dir.startsWith(os.tmpdir())).toBe(true);
  });
});
