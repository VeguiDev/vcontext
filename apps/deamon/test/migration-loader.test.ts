import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { loadProjectMigrations } from "../src/project/migration-loader.js";
import { compareSemver } from "../src/project/semver.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project migration discovery", () => {
  it("loads migration files, ignores other files, calculates checksums, and sorts semver", async () => {
    const directory = await temporaryDirectory();
    await writeMigration(directory, "1.10.0-later.mjs", "1.10.0", "Later");
    await writeMigration(directory, "1.2.0-earlier.mjs", "1.2.0", "Earlier");
    await fs.writeFile(path.join(directory, "README.md"), "ignored");
    await fs.writeFile(
      path.join(directory, "helper.ts"),
      "export const helper = true",
    );

    const migrations = await loadProjectMigrations(directory);

    assert.deepEqual(
      migrations.map((migration) => migration.version),
      ["1.2.0", "1.10.0"],
    );
    assert.ok(
      migrations.every((migration) =>
        /^[a-f0-9]{64}$/.test(migration.checksum),
      ),
    );
  });

  it("uses semantic rather than lexicographic version ordering", () => {
    assert.ok(compareSemver("1.10.0", "1.2.0") > 0);
    assert.ok(compareSemver("2.0.0-beta.2", "2.0.0-beta.10") < 0);
    assert.ok(compareSemver("2.0.0", "2.0.0-rc.1") > 0);
  });

  it("normalizes line endings before calculating checksums", async () => {
    const lfDirectory = await temporaryDirectory();
    const crlfDirectory = await temporaryDirectory();
    const source =
      'export default { version: "1.0.0", name: "Stable", migrate() {} };\n';
    await fs.writeFile(path.join(lfDirectory, "1.0.0-stable.mjs"), source);
    await fs.writeFile(
      path.join(crlfDirectory, "1.0.0-stable.mjs"),
      source.replaceAll("\n", "\r\n"),
    );

    const [lf] = await loadProjectMigrations(lfDirectory);
    const [crlf] = await loadProjectMigrations(crlfDirectory);

    assert.equal(lf?.checksum, crlf?.checksum);
  });

  it("rejects invalid exported versions", async () => {
    const directory = await temporaryDirectory();
    await writeMigration(directory, "1.0.0-invalid.mjs", "01.0.0", "Invalid");
    await assert.rejects(
      loadProjectMigrations(directory),
      /invalid semantic version/,
    );
  });

  it("rejects duplicate versions", async () => {
    const directory = await temporaryDirectory();
    await writeMigration(directory, "1.0.0-one.mjs", "1.0.0", "One");
    await writeMigration(directory, "1.0.0-two.mjs", "1.0.0", "Two");
    await assert.rejects(
      loadProjectMigrations(directory),
      /Duplicate.*1\.0\.0/,
    );
  });

  it("validates names and lifecycle methods", async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(
      path.join(directory, "1.0.0-bad.mjs"),
      "export default { version: '1.0.0', name: '', migrate: true };",
    );
    await assert.rejects(loadProjectMigrations(directory), /non-empty name/);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "vcontext-loader-"));
  directories.push(directory);
  return directory;
}

function writeMigration(
  directory: string,
  filename: string,
  version: string,
  name: string,
) {
  return fs.writeFile(
    path.join(directory, filename),
    `export default { version: "${version}", name: "${name}", migrate() {} };`,
  );
}
