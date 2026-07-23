import assert from "node:assert/strict";
import test from "node:test";
import { configureUi } from "../src/ui/index.js";
import { automaticUpdateChecksEnabled } from "../src/update/automatic.js";

function ui(options: { tty?: boolean; quiet?: boolean; json?: boolean } = {}) {
  const tty = options.tty ?? true;
  const writer = {
    isTTY: tty,
    columns: 80,
    write() {},
  };
  return configureUi(
    {
      noColor: true,
      quiet: options.quiet,
      json: options.json,
    },
    {
      input: { isTTY: tty },
      output: writer,
      error: writer,
      isTTY: tty,
    },
  );
}

test("automatic checks only run for interactive standalone commands", () => {
  const standalone = { VCONTEXT_STANDALONE: "1" };
  assert.equal(automaticUpdateChecksEnabled("status", ui(), standalone), true);
  assert.equal(
    automaticUpdateChecksEnabled("status", ui({ tty: false }), standalone),
    false,
  );
  assert.equal(
    automaticUpdateChecksEnabled("status", ui({ quiet: true }), standalone),
    false,
  );
  assert.equal(
    automaticUpdateChecksEnabled("status", ui({ json: true }), standalone),
    false,
  );
  assert.equal(automaticUpdateChecksEnabled("update", ui(), standalone), false);
  assert.equal(automaticUpdateChecksEnabled("mcp", ui(), standalone), false);
  assert.equal(
    automaticUpdateChecksEnabled(undefined, ui(), standalone),
    false,
  );
});

test("development and opted-out environments never check automatically", () => {
  assert.equal(automaticUpdateChecksEnabled("status", ui(), {}), false);
  assert.equal(
    automaticUpdateChecksEnabled("status", ui(), {
      VCONTEXT_STANDALONE: "1",
      VCONTEXT_NO_UPDATE_CHECK: "1",
    }),
    false,
  );
});
