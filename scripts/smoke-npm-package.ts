import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_DIR = join(ROOT, "apps", "cli");
const TMP_DIR = join(tmpdir(), "vcontext-smoke-" + Date.now());
const DIST_DIR = join(CLI_DIR, "dist", "npm");
const CLI_ENTRY = join(DIST_DIR, "vcontext.mjs");
const DAEMON_ENTRY = join(DIST_DIR, "vcontext-daemon.mjs");
const PACKAGE_JSON = join(CLI_DIR, "package.json");

function run(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${label}`);
  } catch (e: unknown) {
    console.log(`  ❌ ${label}`);
    const err = e as Error & { stdout?: string; stderr?: string };
    if (err.stdout) console.error("    stdout:", err.stdout.toString().trim().split("\n").slice(-3).join("\n"));
    if (err.stderr) console.error("    stderr:", err.stderr.toString().trim().split("\n").slice(-3).join("\n"));
    process.exit(1);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// 1. Prerequisites
run("bundles exist", () => {
  assert(existsSync(CLI_ENTRY), `CLI entry not found: ${CLI_ENTRY}`);
  assert(existsSync(DAEMON_ENTRY), `Daemon entry not found: ${DAEMON_ENTRY}`);
});

let tarballPath = "";
mkdirSync(TMP_DIR, { recursive: true });
run("npm pack produces a tarball with correct contents", () => {
  const out = execSync("npm pack --pack-destination " + TMP_DIR, { cwd: CLI_DIR, encoding: "utf-8" });
  tarballPath = join(TMP_DIR, out.trim());
  assert(existsSync(tarballPath), `tarball not found: ${tarballPath}`);
});

// 4. CLI binary runs from bundle
run("node vcontext.mjs --version", () => {
  const out = execSync(`node "${CLI_ENTRY}" --version`, { encoding: "utf-8" });
  assert(out.includes("0.1"), `version output: ${out}`);
  assert(out.includes("npm"), `distribution: ${out}`);
});

// 5. CLI help works
run("node vcontext.mjs --help exits 0", () => {
  const out = execSync(`node "${CLI_ENTRY}" --help`, { encoding: "utf-8" });
  assert(out.includes("vcontext"), `help output: ${out}`);
});

// 6. Daemon file is valid and has correct exports
run("daemon module is valid ESM with expected content", () => {
  const content = readFileSync(DAEMON_ENTRY, "utf-8");
  assert(content.includes("import"), `daemon has no imports: ${content.slice(0, 100)}`);
  assert(content.includes("startDaemon") || content.includes("serve") || content.includes("listen"), `daemon missing start: ${content.slice(0, 200)}`);
});

// 7. No workspace specifiers in bundles
run("bundles are free of workspace references", () => {
  for (const entry of [CLI_ENTRY, DAEMON_ENTRY]) {
    const content = readFileSync(entry, "utf-8");
    const wsImport = /(?:from\s+|import\s*(?:\(\s*)?|require\(\s*)["'](?:@repo|@app|@vcontext)\//;
    assert(!wsImport.test(content), `${entry} contains workspace import`);
    assert(!content.includes("workspace:"), `${entry} contains workspace:`);
  }
});

// 8. Node engine compatibility
run("node engines field is >=18", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
  assert(pkg.engines?.node?.startsWith(">="), `engines missing: ${JSON.stringify(pkg.engines)}`);
});

// 9. Bin entry matches bundle
run("bin entry points to vcontext.mjs", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
  assert(pkg.bin?.vcontext?.endsWith("vcontext.mjs"), `bin entry: ${JSON.stringify(pkg.bin)}`);
  assert(existsSync(join(CLI_DIR, pkg.bin.vcontext)), `bin path missing: ${pkg.bin.vcontext}`);
});

// 10. Install into temporary prefix (simulates npm install -g)
const installDir = join(TMP_DIR, "install");
run("tarball installs into a temp prefix", () => {
  execSync(`npm install --prefix "${installDir}" "${tarballPath}"`, { encoding: "utf-8", timeout: 60000 });
  const installedBin = join(installDir, "node_modules", ".bin", "vcontext.cmd");
  assert(existsSync(installedBin), `installed bin not found: ${installedBin}`);

  // In npm install, the .cmd file calls the mjs entry via node
  const installedMjs = join(installDir, "node_modules", "vcontext", "dist", "npm", "vcontext.mjs");
  assert(existsSync(installedMjs), `installed mjs not found: ${installedMjs}`);

  // Also verify daemon bundle was installed
  const installedDaemon = join(installDir, "node_modules", "vcontext", "dist", "npm", "vcontext-daemon.mjs");
  assert(existsSync(installedDaemon), `installed daemon not found: ${installedDaemon}`);
});

// Cleanup
rmSync(TMP_DIR, { recursive: true, force: true });

console.log(`\n🎉 All ${10} smoke checks passed.`);
