import assert from "node:assert/strict";
import test from "node:test";
import { configureUi, parseGlobalOptions } from "../src/ui/index.js";
import { errorData } from "../src/ui/errors.js";

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
  const ui = configureUi({ noColor: true });
  assert.equal(ui.brand("vcontext"), "vcontext");
  assert.equal(ui.green("done"), "done");
  assert.equal(ui.command("vcontext status"), "vcontext status");
});

test("unexpected errors have actionable diagnostics", () => {
  const value = errorData(new Error("internal detail"));
  assert.equal(value.code, "UNEXPECTED_ERROR");
  assert.match(value.message, /Unexpected error/);
  assert.match(value.hint ?? "", /--verbose/);
});
