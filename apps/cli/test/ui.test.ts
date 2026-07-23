import assert from "node:assert/strict";
import test from "node:test";
import { DaemonClientError } from "@repo/daemon-client";
import { configureUi, parseGlobalOptions } from "../src/ui/index.js";
import { errorData } from "../src/ui/errors.js";

function captureUi(
  options: {
    tty?: boolean;
    color?: boolean;
    columns?: number;
    quiet?: boolean;
    json?: boolean;
  } = {},
) {
  const output: string[] = [];
  const errors: string[] = [];
  const tty = options.tty ?? true;
  const writer = (target: string[]) => ({
    isTTY: tty,
    columns: options.columns ?? 100,
    write(chunk: string) {
      target.push(chunk);
    },
  });
  const ui = configureUi(
    {
      noColor: options.color !== true,
      quiet: options.quiet ?? false,
      json: options.json ?? false,
    },
    {
      input: { isTTY: tty },
      output: writer(output),
      error: writer(errors),
      isTTY: tty,
      color: options.color ?? false,
      columns: options.columns ?? 100,
    },
  );
  return {
    ui,
    output: () => output.join(""),
    errors: () => errors.join(""),
  };
}

test("global options are parsed centrally", () => {
  const input = ["status", "--json", "--verbose", "--no-color", "--yes"];
  const options = parseGlobalOptions(input);
  assert.deepEqual(input, ["status"]);
  assert.equal(options.json, true);
  assert.equal(options.verbose, true);
  assert.equal(options.noColor, true);
  assert.equal(options.yes, true);
});

test("no-color styling is semantic without ANSI sequences", () => {
  const { ui } = captureUi();
  assert.equal(ui.brand("vcontext"), "vcontext");
  assert.equal(ui.green("done"), "done");
  assert.equal(ui.command("vcontext status"), "vcontext status");
});

test("brand color uses the landing palette", () => {
  const { ui } = captureUi({ color: true });
  assert.match(ui.brand("vcontext"), /\u001B\[38;2;84;160;255m/);
});

test("rich output uses semantic markers", () => {
  const capture = captureUi();
  capture.ui.success("Context saved");
  capture.ui.note("Snapshot ready");
  capture.ui.warn("Remote moved");
  assert.equal(
    capture.output(),
    "✓ Context saved\n│ Snapshot ready\n⚠ Remote moved\n",
  );
});

test("plain output removes ANSI and ornaments", () => {
  const capture = captureUi({ tty: false });
  capture.ui.success("Context saved");
  capture.ui.note("Snapshot ready");
  capture.ui.warn("Remote moved");
  capture.ui.error({
    code: "REMOTE_MOVED",
    message: "Remote moved",
    hint: "Accept the new URL",
  });
  assert.equal(
    capture.output(),
    "Context saved\nSnapshot ready\nWarning: Remote moved\n",
  );
  assert.equal(
    capture.errors(),
    "Error: Remote moved\nCode: REMOTE_MOVED\nHint: Accept the new URL\n",
  );
});

test("rich errors separate message, metadata, notes, and recovery", () => {
  const capture = captureUi();
  capture.ui.error({
    code: "PROJECT_NOT_FOUND",
    status: 404,
    message:
      "This repository uses a legacy VContext marker and is not registered.",
    notes: ["The repository was not modified."],
    hint: "Run `vcontext init <project-name> --remote <namespace>/<slug> --path .` to upgrade it.",
  });
  assert.equal(
    capture.errors(),
    [
      "╭ × Error ─────────────────────────────────────────────────────────────────────────────╮",
      "│                                                                                      │",
      "│  This repository uses a legacy VContext marker and is not registered.                │",
      "│                                                                                      │",
      "│  PROJECT_NOT_FOUND · HTTP 404                                                        │",
      "│  The repository was not modified.                                                    │",
      "│                                                                                      │",
      "╰──────────────────────────────────────────────────────────────────────────────────────╯",
      "",
      "❯ Run `vcontext init <project-name> --remote <namespace>/<slug> --path .` to upgrade it.",
      "",
    ].join("\n"),
  );
});

test("rich error boxes wrap to narrow terminals", () => {
  const capture = captureUi({ columns: 40 });
  capture.ui.error({
    code: "PROJECT_NOT_FOUND",
    status: 404,
    message:
      "This repository uses a legacy VContext marker and is not registered.",
    notes: ["The repository was not modified."],
    hint: "Run `vcontext init <project-name> --path .` to upgrade it.",
  });
  assert.equal(
    capture.errors(),
    [
      "╭ × Error ─────────────────────────────╮",
      "│                                      │",
      "│  This repository uses a legacy       │",
      "│  VContext marker and is not          │",
      "│  registered.                         │",
      "│                                      │",
      "│  PROJECT_NOT_FOUND · HTTP 404        │",
      "│  The repository was not modified.    │",
      "│                                      │",
      "╰──────────────────────────────────────╯",
      "",
      "❯ Run `vcontext init <project-name> --path .` to upgrade it.",
      "",
    ].join("\n"),
  );
  assert.ok(
    capture
      .errors()
      .split("\n")
      .filter((line) => line.startsWith("│") || line.startsWith("╭"))
      .every((line) => line.length <= 40),
  );
});

test("rich error titles and recovery actions use semantic colors", () => {
  const capture = captureUi({ color: true, columns: 60 });
  capture.ui.error({
    code: "CLI_ERROR",
    message: "Something failed.",
    hint: "Run `vcontext status`.",
  });
  assert.match(capture.errors(), /\u001B\[38;2;255;107;107m× Error\u001B\[39m/);
  assert.match(
    capture.errors(),
    /\u001B\[38;2;84;160;255m\u001B\[1m❯\u001B\[22m\u001B\[39m/,
  );
  assert.match(
    capture.errors(),
    /\u001B\[38;2;84;160;255m\u001B\[1mvcontext status\u001B\[22m\u001B\[39m/,
  );
});

test("daemon errors preserve structured recovery metadata", () => {
  const error = new DaemonClientError(
    "This repository uses a legacy VContext marker.",
    3,
    undefined,
    {
      code: "PROJECT_NOT_FOUND",
      status: 404,
      hint: "Run `vcontext init demo --remote acme/demo --path .`.",
      details: { note: "The repository was not modified." },
    },
  );
  assert.deepEqual(errorData(error), {
    code: "PROJECT_NOT_FOUND",
    status: 404,
    message: "This repository uses a legacy VContext marker.",
    hint: "Run `vcontext init demo --remote acme/demo --path .`.",
    notes: ["The repository was not modified."],
    details: { note: "The repository was not modified." },
    debug: { stack: error.stack },
  });
  assert.equal(
    errorData(error, "vcontext-dev").hint,
    "Run `vcontext-dev init demo --remote acme/demo --path .`.",
  );
  assert.equal(
    errorData(
      new DaemonClientError("Usage: vcontext status [project]", 2),
      "vcontext-dev",
    ).message,
    "Usage: vcontext-dev status [project]",
  );
});

test("legacy flattened API errors are normalized for older daemons", () => {
  const value = errorData(
    new DaemonClientError(
      "API error 404: PROJECT_NOT_FOUND: Project missing. Run `vcontext projects`.",
      3,
    ),
  );
  assert.equal(value.code, "PROJECT_NOT_FOUND");
  assert.equal(value.status, 404);
  assert.equal(value.message, "Project missing");
  assert.equal(value.hint, "Run `vcontext projects`.");
});

test("quiet and json modes do not leak human status output", () => {
  const quiet = captureUi({ quiet: true });
  quiet.ui.success("Hidden");
  quiet.ui.note("Hidden");
  assert.equal(quiet.output(), "");

  const json = captureUi({ json: true });
  json.ui.success("Hidden");
  json.ui.json({ ok: true });
  assert.equal(json.output(), '{\n  "ok": true\n}\n');

  json.ui.error({
    code: "PROJECT_NOT_FOUND",
    status: 404,
    message: "Project missing",
    hint: "Run `vcontext projects`.",
  });
  assert.equal(
    json.errors(),
    '{"error":{"code":"PROJECT_NOT_FOUND","message":"Project missing","hint":"Run `vcontext projects`."}}\n',
  );
});

test("update notices use the rich brand box and stay silent in plain output", () => {
  const rich = captureUi({ columns: 60 });
  rich.ui.updateAvailable("0.1.1+12", "0.1.1+13");
  assert.match(rich.errors(), /╭ Update available ─+/);
  assert.match(rich.errors(), /0\.1\.1\+12 → 0\.1\.1\+13/);
  assert.match(rich.errors(), /❯ Run vcontext update/);

  const plain = captureUi({ tty: false });
  plain.ui.updateAvailable("0.1.1+12", "0.1.1+13");
  assert.equal(plain.errors(), "");
});

test("unexpected errors have actionable diagnostics", () => {
  const value = errorData(new Error("internal detail"));
  assert.equal(value.code, "UNEXPECTED_ERROR");
  assert.match(value.message, /Unexpected error/);
  assert.match(value.hint ?? "", /--verbose/);
});
