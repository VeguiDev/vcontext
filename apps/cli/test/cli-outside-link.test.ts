import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import type { CLIVContextAPI } from "../src/vcontext-api.js";
import {
  CLI_ENTRY,
  type DaemonFixture,
  startDaemonFixture,
} from "./integration-harness.js";

const PROJECT_NAME = "cli-outside-link-test";
const PROJECT_SLUG = "cli-outside-link-test";

let fixture: DaemonFixture | undefined;
let api: CLIVContextAPI | undefined;

before(async () => {
  fixture = await startDaemonFixture();
  process.env.VCONTEXT_HOME = fixture.home;
  execFileSync(
    process.execPath,
    [CLI_ENTRY, "init", PROJECT_NAME, "--path", fixture.projectPath],
    {
      cwd: fixture.projectPath,
      env: fixture.env,
      stdio: "pipe",
    },
  );
  const module = await import("../src/vcontext-api.js");
  api = new module.CLIVContextAPI();
});

after(async () => {
  await fixture?.stop();
});

describe("CLI outside-link CRUD via CLIVContextAPI", () => {
  it("lists no outside links initially", async () => {
    assert.ok(api);
    const links = await api.outsideLinksList({ project_slug: PROJECT_SLUG });
    assert.deepEqual(links, []);
  });

  it("creates an outside link", async () => {
    assert.ok(api);
    const link = await api.outsideLinksAdd(
      {
        target_project_slug: "dependency-project",
        target_type: "project",
        kind: "api",
        description: "Uses dependency-project API",
      },
      { project_slug: PROJECT_SLUG },
    );
    const record = link as {
      record_id: string;
      target_project_slug: string;
      target_type: string;
      kind: string;
      description: string;
    };
    assert.ok(record.record_id);
    assert.equal(record.target_project_slug, "dependency-project");
    assert.equal(record.target_type, "project");
    assert.equal(record.kind, "api");
    assert.equal(record.description, "Uses dependency-project API");
  });

  it("lists outside links after creation", async () => {
    assert.ok(api);
    const links = await api.outsideLinksList({ project_slug: PROJECT_SLUG });
    assert.ok(links.length >= 1);
    const records = links as Array<{ target_project_slug: string }>;
    assert.ok(
      records.some((l) => l.target_project_slug === "dependency-project"),
    );
  });

  it("gets a specific outside link by record_id", async () => {
    assert.ok(api);
    const created = await api.outsideLinksAdd(
      {
        target_project_slug: "show-me",
        target_type: "file",
        kind: "lib",
        description: "Show this link",
      },
      { project_slug: PROJECT_SLUG },
    );
    const createdRec = created as { record_id: string };
    const shown = await api.outsideLinksGet(createdRec.record_id, {
      project_slug: PROJECT_SLUG,
    });
    const shownRec = shown as { record_id: string; description: string };
    assert.equal(shownRec.record_id, createdRec.record_id);
    assert.equal(shownRec.description, "Show this link");
  });

  it("deletes an outside link", async () => {
    assert.ok(api);
    const created = await api.outsideLinksAdd(
      {
        target_project_slug: "delete-me",
        target_type: "directory",
        kind: "import",
        description: "Delete this link",
      },
      { project_slug: PROJECT_SLUG },
    );
    const createdRec = created as { record_id: string };
    const result = await api.outsideLinksDelete(createdRec.record_id, {
      project_slug: PROJECT_SLUG,
    });
    const resultRec = result as { deleted: boolean };
    assert.equal(resultRec.deleted, true);
    const links = await api.outsideLinksList({ project_slug: PROJECT_SLUG });
    const records = links as Array<{ record_id: string }>;
    assert.ok(!records.some((l) => l.record_id === createdRec.record_id));
  });
});
