import { describe, test, afterAll } from "bun:test";
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import * as assert from "node:assert/strict";

const DIST = "apps/cli/dist/npm";

describe("npm package build", () => {
  test("builder succeeds", () => {
    const out = execSync("bun scripts/build-npm-package.ts", { encoding: "utf-8" });
    assert.ok(out.includes("npm bundles OK"), `build output: ${out}`);
  });

  test("vcontext.mjs exists with shebang", async () => {
    const buf = await readFile(`${DIST}/vcontext.mjs`);
    assert.ok(buf.byteLength > 0, "vcontext.mjs is empty");
    const first = buf.subarray(0, 20).toString();
    assert.ok(first.startsWith("#!/usr/bin/env node"), `wrong shebang: ${first}`);
  });

  test("vcontext-daemon.mjs exists without shebang", async () => {
    const buf = await readFile(`${DIST}/vcontext-daemon.mjs`);
    assert.ok(buf.byteLength > 0, "vcontext-daemon.mjs is empty");
    const first = buf.subarray(0, 4).toString();
    assert.notEqual(first, "#!/us", "daemon should not have shebang");
  });

  test("--version prints version and npm", () => {
    const out = execSync(`node ${DIST}/vcontext.mjs --version`, { encoding: "utf-8" });
    assert.ok(out.includes("0.1"), `version output: ${out}`);
    assert.ok(out.includes("npm"), `distribution output: ${out}`);
  });

  test("no workspace specifiers in bundles", () => {
    for (const name of ["vcontext.mjs", "vcontext-daemon.mjs"]) {
      const content = execSync(`node -e "process.stdout.write(require('fs').readFileSync('${DIST}/${name}','utf-8'))"`, { encoding: "utf-8" });
      const workspaceImport = /(?:from\s+|import\s*(?:\(\s*)?|require\(\s*)["'](?:@repo|@app|@vcontext)\//;
      assert.ok(!workspaceImport.test(content), `${name} contains a workspace import`);
      assert.ok(!content.includes("workspace:"), `${name} contains workspace:`);
    }
  });
});


