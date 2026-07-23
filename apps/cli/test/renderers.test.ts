import assert from "node:assert/strict";
import test from "node:test";
import { configureUi } from "../src/ui/index.js";
import {
  renderContext,
  renderEntityMutation,
  renderPairs,
  renderProjectInit,
  renderTable,
} from "../src/ui/renderers.js";

function captureRenderer(options: { tty?: boolean; columns?: number } = {}) {
  const chunks: string[] = [];
  const tty = options.tty ?? true;
  const output = {
    isTTY: tty,
    columns: options.columns ?? 100,
    write(chunk: string) {
      chunks.push(chunk);
    },
  };
  const ui = configureUi(
    { noColor: true },
    {
      input: { isTTY: tty },
      output,
      error: output,
      isTTY: tty,
      color: false,
      columns: options.columns ?? 100,
    },
  );
  return { ui, output: () => chunks.join("") };
}

test("rich pairs use the landing-inspired brand rail", () => {
  const capture = captureRenderer();
  renderPairs(capture.ui, [
    ["Project", "api-platform"],
    ["Branch", "main"],
    ["Context", "ready for agents"],
  ]);
  assert.equal(
    capture.output(),
    [
      "│ project  api-platform",
      "│ branch   main",
      "│ context  ready for agents",
      "",
    ].join("\n"),
  );
});

test("plain pairs remain stable label-value lines", () => {
  const capture = captureRenderer({ tty: false });
  renderPairs(capture.ui, [
    ["Project", "api-platform"],
    ["Branch", "main"],
  ]);
  assert.equal(capture.output(), "Project: api-platform\nBranch: main\n");
});

test("wide tables align while narrow terminals stack rows", () => {
  const wide = captureRenderer({ columns: 100 });
  renderTable(
    wide.ui,
    ["Branch", "Snapshot"],
    [
      ["main", "snapshot-main"],
      ["auth-flow", "snapshot-auth"],
    ],
  );
  assert.match(wide.output(), /│ BRANCH\s+SNAPSHOT/);
  assert.match(wide.output(), /│ main\s+snapshot-main/);

  const narrow = captureRenderer({ columns: 40 });
  renderTable(
    narrow.ui,
    ["Branch", "Snapshot"],
    [["main-with-a-long-name", "snapshot-with-a-long-identifier"]],
  );
  assert.equal(
    narrow.output(),
    "│ branch    main-with-a-long-name\n│ snapshot  snapshot-with-a-long-identifier\n",
  );
});

test("entity mutations are compact and keep the complete snapshot id", () => {
  const capture = captureRenderer();
  renderEntityMutation(
    "document",
    {
      record_id: "document-1",
      snapshot_id: "8ef92a1-full-snapshot-id",
      title: "Architecture",
      content: "Hono API",
    },
    capture.ui,
    "create",
  );
  assert.equal(
    capture.output(),
    "✓ Document created · snapshot 8ef92a1-full-snapshot-id\n",
  );
});

test("project init mirrors the landing success output with actionable data", () => {
  const capture = captureRenderer();
  renderProjectInit({ slug: "api-platform" }, capture.ui, {
    path: "C:\\repos\\api-platform",
  });
  assert.equal(
    capture.output(),
    [
      "✓ Project registered · branch main",
      "│ project  api-platform",
      "│ path     C:\\repos\\api-platform",
      "",
    ].join("\n"),
  );
});

test("give-context stays byte-oriented in pipes and styled in a TTY", () => {
  const context = [
    "Project: API Platform",
    "Slug: api-platform",
    "",
    "Active tasks:",
    "- [RUNNING] Ship CLI",
  ].join("\n");
  const plain = captureRenderer({ tty: false });
  renderContext(context, plain.ui);
  assert.equal(plain.output(), `${context}\n`);

  const rich = captureRenderer();
  renderContext(context, rich.ui);
  assert.match(rich.output(), /vcontext \/ context/);
  assert.match(rich.output(), /│ project  API Platform/);
  assert.match(rich.output(), /Active tasks/);
  assert.match(rich.output(), /│ · \[RUNNING\] Ship CLI/);
});
