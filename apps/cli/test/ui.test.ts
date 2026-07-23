import assert from "node:assert/strict";
import test from "node:test";
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
    "Error: Remote moved\nHint: Accept the new URL\n",
  );
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
});

test("unexpected errors have actionable diagnostics", () => {
  const value = errorData(new Error("internal detail"));
  assert.equal(value.code, "UNEXPECTED_ERROR");
  assert.match(value.message, /Unexpected error/);
  assert.match(value.hint ?? "", /--verbose/);
});
