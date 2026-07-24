import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  configPath,
  configureMcp,
  type McpAgent,
} from "../src/runtime/mcp-config.js";

describe("MCP configuration", () => {
  let root = "";
  let project = "";
  let home = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "vcontext-mcp-setup-"));
    project = path.join(root, "project");
    home = path.join(root, "home");
    fs.mkdirSync(project);
    fs.mkdirSync(home);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const agent of ["codex", "claude", "opencode"] as McpAgent[]) {
    it(`writes idempotent local ${agent} configuration`, () => {
      const first = configureMcp(agent, "local", {
        cwd: project,
        home,
        command: "vcontext-dev",
        checkAgent: false,
      });
      const content = fs.readFileSync(first.path, "utf8");
      const second = configureMcp(agent, "local", {
        cwd: project,
        home,
        command: "vcontext-dev",
        checkAgent: false,
      });
      assert.equal(second.updated, false);
      assert.equal(fs.readFileSync(first.path, "utf8"), content);
      assert.match(content, /vcontext-dev/);
      assert.match(content, /mcp/);
    });

    it(`uses the global ${agent} configuration location`, () => {
      const result = configureMcp(agent, "global", {
        cwd: project,
        home,
        checkAgent: false,
      });
      assert.equal(result.path, configPath(agent, "global", project, home));
      assert.equal(fs.existsSync(result.path), true);
    });
  }

  it("preserves unrelated Codex TOML and replaces only vcontext", () => {
    const target = configPath("codex", "local", project, home);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      [
        'model = "example"',
        "",
        "[mcp_servers.other]",
        'command = "other"',
        "",
        "[mcp_servers.vcontext]",
        'command = "old"',
        'args = ["old"]',
        "",
      ].join("\n"),
    );
    configureMcp("codex", "local", {
      cwd: project,
      home,
      command: "vcontext",
      checkAgent: false,
    });
    const content = fs.readFileSync(target, "utf8");
    assert.match(content, /model = "example"/);
    assert.match(content, /\[mcp_servers\.other]/);
    assert.doesNotMatch(content, /command = "old"/);
    assert.equal(content.match(/\[mcp_servers\.vcontext]/g)?.length, 1);
  });

  it("preserves JSONC comments and unrelated OpenCode settings", () => {
    const target = configPath("opencode", "local", project, home);
    fs.writeFileSync(target, '{\n  // keep this\n  "theme": "system",\n}\n');
    configureMcp("opencode", "local", {
      cwd: project,
      home,
      checkAgent: false,
    });
    const content = fs.readFileSync(target, "utf8");
    assert.match(content, /\/\/ keep this/);
    assert.match(content, /"theme": "system"/);
    assert.match(content, /"vcontext"/);
  });

  it("rejects invalid configuration without overwriting it", () => {
    const target = configPath("claude", "local", project, home);
    fs.writeFileSync(target, "{ invalid");
    assert.throws(
      () =>
        configureMcp("claude", "local", {
          cwd: project,
          home,
          checkAgent: false,
        }),
      /not valid JSON/,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "{ invalid");
  });
});
