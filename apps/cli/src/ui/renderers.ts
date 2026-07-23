import type { CliUi } from "./index.js";

type RecordValue = Record<string, unknown>;
export type EntityKind =
  | "document"
  | "project_prompt"
  | "task"
  | "change_note"
  | "file_context";

const label: Record<EntityKind, string> = {
  document: "Document",
  project_prompt: "Prompt",
  task: "Task",
  change_note: "Change",
  file_context: "File context",
};

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? text(value) : date.toLocaleString();
}

function reference(value: unknown, ui: CliUi): string {
  const rendered = text(value);
  return rendered ? ui.id(rendered) : "—";
}

export function renderHeading(ui: CliUi, title: string): void {
  ui.line(
    ui.rich
      ? `${ui.dim("vcontext /")} ${ui.brand(title.toLowerCase())}`
      : title,
  );
  ui.line();
}

export function renderPairs(
  ui: CliUi,
  entries: Array<[string, unknown]>,
): void {
  const present = entries.filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  const width = Math.max(0, ...present.map(([name]) => name.length));
  for (const [name, value] of present) {
    const lines = text(value).split("\n");
    if (!ui.rich) {
      ui.line(`${name}: ${lines[0] ?? ""}`);
      for (const line of lines.slice(1)) ui.line(`  ${line}`);
      continue;
    }
    ui.line(
      `${ui.brand("│")} ${ui.dim(name.toLowerCase().padEnd(width))}  ${lines[0] ?? ""}`,
    );
    for (const line of lines.slice(1))
      ui.line(`${ui.brand("│")} ${"".padEnd(width)}  ${line}`);
  }
}

export function renderSection(
  ui: CliUi,
  title: string,
  draw: () => void,
): void {
  ui.line();
  ui.line(ui.rich ? ui.brand(title) : title);
  draw();
}

export function renderEmpty(ui: CliUi): void {
  ui.line(ui.rich ? ui.dim("No entries.") : "No entries.");
}

export function renderTable(
  ui: CliUi,
  headers: string[],
  rows: string[][],
): void {
  if (rows.length === 0) return renderEmpty(ui);
  if (!ui.rich) {
    for (const row of rows) ui.line(row.join("\t"));
    return;
  }
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const required =
    2 + widths.reduce((total, width) => total + width, 0) + 2 * headers.length;
  if (required > ui.columns) {
    for (const [index, row] of rows.entries()) {
      if (index > 0) ui.line();
      renderPairs(
        ui,
        headers.map((header, column) => [header, row[column] ?? ""]),
      );
    }
    return;
  }
  const line = (row: string[], styleHeader = false) =>
    `${ui.brand("│")} ${row
      .map((cell, index) => {
        const padded = cell.padEnd(widths[index] ?? cell.length);
        return styleHeader ? ui.dim(padded.toUpperCase()) : padded;
      })
      .join("  ")}`;
  ui.line(line(headers, true));
  for (const row of rows) ui.line(line(row));
}

export function renderResult(
  ui: CliUi,
  message: string,
  details: Array<[string, unknown]> = [],
): void {
  if (ui.options.quiet || ui.options.json) return;
  ui.success(message);
  if (details.length > 0) renderPairs(ui, details);
}

export function renderObject(value: unknown, ui: CliUi, title: string): void {
  const record = object(value);
  if (!record) {
    ui.info(text(value));
    return;
  }
  renderHeading(ui, title);
  renderPairs(
    ui,
    Object.entries(record).map(([key, item]) => [
      key.replaceAll("_", " "),
      Array.isArray(item) ? item.map(text).join(", ") : item,
    ]),
  );
}

export function renderContext(value: string, ui: CliUi): void {
  if (!ui.rich) {
    ui.line(value);
    return;
  }
  const lines = value.split("\n");
  const metadata: Array<[string, unknown]> = [];
  while (/^(Project|Slug): /.test(lines[0] ?? "")) {
    const [name, ...rest] = lines.shift()!.split(":");
    metadata.push([name!, rest.join(":").trim()]);
  }
  while (lines[0] === "") lines.shift();
  renderHeading(ui, "Context");
  renderPairs(ui, metadata);
  for (const line of lines) {
    if (line.endsWith(":") && !line.startsWith("-")) {
      ui.line();
      ui.line(ui.brand(line.slice(0, -1)));
    } else if (line.startsWith("## ")) {
      ui.line(ui.brand(line));
    } else if (line.startsWith("- ")) {
      ui.line(`${ui.brand("│")} ${ui.dim("·")} ${line.slice(2)}`);
    } else {
      ui.line(line);
    }
  }
}

function status(value: unknown, ui: CliUi): string {
  const rendered = text(value);
  if (["COMPLETED", "ADDED", "CREATED"].includes(rendered))
    return ui.green(rendered);
  if (["RUNNING", "UPDATED", "MODIFIED"].includes(rendered))
    return ui.yellow(rendered);
  if (["CANCELLED", "DELETED", "REMOVED"].includes(rendered))
    return ui.red(rendered);
  return rendered;
}

function summary(record: RecordValue, entity: EntityKind): string {
  if (entity === "document" || entity === "task") return text(record.title);
  if (entity === "project_prompt") return text(record.prompt);
  if (entity === "change_note") return text(record.note);
  return text(record.path);
}

export function renderStatus(value: unknown, ui: CliUi): void {
  const data = object(value);
  if (!data) return renderEmpty(ui);
  const counts = object(data.counts) ?? {};
  renderHeading(ui, "Status");
  renderPairs(ui, [
    ["Project", data.name],
    ["Slug", data.slug],
    ["Branch", ui.branch(text(data.current_branch))],
    ["Documents", counts.document],
    ["Tasks", counts.task],
    ["Changes", counts.change_note],
    ["File context", counts.file_context],
  ]);
  if (data.head_message)
    renderSection(ui, "Last change", () =>
      ui.line(
        ui.rich
          ? `${ui.brand("│")} ${text(data.head_message)}`
          : text(data.head_message),
      ),
    );
  if (ui.options.verbose)
    renderSection(ui, "Technical details", () =>
      renderPairs(ui, [
        ["Snapshot", reference(data.current_snapshot_id, ui)],
        ["Updated", timestamp(data.head_created_at)],
        ["Local path", data.local_path],
        ["Branches", data.branch_count],
      ]),
    );
}

export function renderProjects(value: unknown, ui: CliUi): void {
  if (!Array.isArray(value) || value.length === 0) return renderEmpty(ui);
  renderHeading(ui, "Projects");
  renderTable(
    ui,
    ["Project", "Slug", "Description"],
    value.flatMap((item) => {
      const project = object(item);
      return project
        ? [[text(project.name), text(project.slug), text(project.description)]]
        : [];
    }),
  );
}

export function renderEntityList(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
): void {
  if (!Array.isArray(value) || value.length === 0) return renderEmpty(ui);
  renderHeading(ui, `${label[entity]}s`);
  const detailHeader =
    entity === "task" ? "Status" : entity === "file_context" ? "Kind" : "";
  renderTable(
    ui,
    ["ID", label[entity], ...(detailHeader ? [detailHeader] : [])],
    value.flatMap((item) => {
      const record = object(item);
      if (!record) return [];
      const detail =
        entity === "task"
          ? text(record.status)
          : entity === "file_context"
            ? text(record.kind)
            : "";
      return [
        [
          text(record.record_id),
          summary(record, entity),
          ...(detailHeader ? [detail] : []),
        ],
      ];
    }),
  );
}

export function renderEntity(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
): void {
  const record = object(value);
  if (!record) return renderEmpty(ui);
  renderHeading(ui, label[entity]);
  const main: Array<[string, unknown]> = [
    ["ID", reference(record.record_id, ui)],
  ];
  if (entity === "document")
    main.push(["Title", record.title], ["Content", record.content]);
  if (entity === "project_prompt") main.push(["Prompt", record.prompt]);
  if (entity === "task")
    main.push(
      ["Title", record.title],
      ["Status", status(record.status, ui)],
      ["Description", record.description],
      ["Document", reference(record.document_id, ui)],
    );
  if (entity === "change_note")
    main.push(
      ["Note", record.note],
      ["Document", reference(record.document_id, ui)],
    );
  if (entity === "file_context")
    main.push(
      ["Path", record.path],
      ["Kind", record.kind],
      ["Description", record.description],
      ["Hash", record.hash],
    );
  renderPairs(ui, main);
  if (ui.options.verbose)
    renderSection(ui, "Technical details", () =>
      renderPairs(ui, [
        ["Revision", reference(record.id, ui)],
        ["Snapshot", reference(record.snapshot_id, ui)],
        ["Updated", timestamp(record.updated_at)],
        ["Created", timestamp(record.created_at)],
      ]),
    );
}

export function renderEntityMutation(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
  action: "create" | "update" | "upsert",
): void {
  const record = object(value);
  if (!record) return renderEmpty(ui);
  const verb =
    action === "create" ? "created" : action === "update" ? "updated" : "saved";
  const snapshot = text(record.snapshot_id);
  const message = snapshot
    ? ui.qualify(`${label[entity]} ${verb}`, `snapshot ${ui.id(snapshot)}`)
    : `${label[entity]} ${verb}`;
  ui.success(message);
  if (ui.options.verbose) {
    ui.line();
    renderEntity(entity, value, ui);
  }
}

export function renderProjectInit(
  value: unknown,
  ui: CliUi,
  input: { path: string; remote?: string },
): void {
  const project = object(value) ?? {};
  if (input.remote) {
    renderResult(ui, ui.qualify("Project linked", input.remote), [
      ["Project", project.slug ?? input.remote],
      ["Path", ui.path(input.path)],
    ]);
    return;
  }
  renderResult(ui, ui.qualify("Project registered", "branch main"), [
    ["Project", project.slug],
    ["Path", ui.path(input.path)],
  ]);
}

export function renderHistory(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
): void {
  if (!Array.isArray(value) || value.length === 0) return renderEmpty(ui);
  renderHeading(ui, `${label[entity]} history`);
  renderTable(
    ui,
    ["Updated", label[entity], "Snapshot"],
    value.flatMap((item) => {
      const record = object(item);
      return record
        ? [
            [
              timestamp(record.updated_at),
              summary(record, entity),
              text(record.snapshot_id),
            ],
          ]
        : [];
    }),
  );
}

export function renderBranches(
  value: unknown,
  ui: CliUi,
  current?: string,
): void {
  if (!Array.isArray(value) || value.length === 0) return renderEmpty(ui);
  renderHeading(ui, "Branches");
  renderTable(
    ui,
    ["", "Branch", "Snapshot"],
    value.flatMap((item) => {
      const branch = object(item);
      if (!branch) return [];
      const name = text(branch.name);
      return [
        [
          current === name ? (ui.rich ? "●" : "*") : "",
          name,
          text(branch.snapshot_id),
        ],
      ];
    }),
  );
}

export function renderBranch(value: unknown, ui: CliUi, action?: string): void {
  const branch = object(value);
  if (!branch) return renderEmpty(ui);
  if (action === "checkout") {
    ui.success(`Checked out ${ui.branch(text(branch.name))}`);
    return;
  }
  if (action === "create") {
    ui.success(`Created branch ${ui.branch(text(branch.name))}`);
    return;
  }
  if (action === "rename") {
    ui.success(`Renamed branch to ${ui.branch(text(branch.name))}`);
    return;
  }
  renderHeading(ui, "Branch");
  renderPairs(ui, [
    ["Name", ui.branch(text(branch.name))],
    ["Snapshot", reference(branch.snapshot_id, ui)],
  ]);
  if (ui.options.verbose)
    renderPairs(ui, [
      ["Updated", timestamp(branch.updated_at)],
      ["Created", timestamp(branch.created_at)],
    ]);
}

export function renderSnapshots(value: unknown, ui: CliUi): void {
  if (!Array.isArray(value) || value.length === 0) return renderEmpty(ui);
  renderHeading(ui, "Snapshots");
  renderTable(
    ui,
    ["Snapshot", "Created", "Branches", "Message"],
    value.flatMap((item) => {
      const snapshot = object(item);
      if (!snapshot) return [];
      return [
        [
          text(snapshot.id),
          timestamp(snapshot.created_at),
          Array.isArray(snapshot.branch_labels)
            ? snapshot.branch_labels.map(text).join(", ")
            : "",
          text(snapshot.message),
        ],
      ];
    }),
  );
}

export function renderSnapshot(value: unknown, ui: CliUi): void {
  const snapshot = object(value);
  if (!snapshot) return renderEmpty(ui);
  renderHeading(ui, "Snapshot");
  renderPairs(ui, [
    ["ID", reference(snapshot.id, ui)],
    ["Message", snapshot.message],
    ["Created", timestamp(snapshot.created_at)],
    [
      "Branches",
      Array.isArray(snapshot.branch_labels)
        ? snapshot.branch_labels.join(", ")
        : "",
    ],
  ]);
  const counts = object(snapshot.counts);
  if (counts)
    renderSection(ui, "Contents", () =>
      renderPairs(ui, [
        ["Documents", counts.document],
        ["Tasks", counts.task],
        ["Changes", counts.change_note],
        ["File context", counts.file_context],
      ]),
    );
}

export function renderDiff(value: unknown, ui: CliUi): void {
  const diff = object(value);
  if (!diff) return renderEmpty(ui);
  renderHeading(
    ui,
    `Diff ${text(diff.from_snapshot_id)} → ${text(diff.to_snapshot_id)}`,
  );
  const changes = Array.isArray(diff.changes) ? diff.changes : [];
  if (changes.length === 0) return renderEmpty(ui);
  for (const entry of changes) {
    const change = object(entry);
    if (!change) continue;
    ui.line(
      ui.rich
        ? `${ui.brand("│")} ${status(change.type, ui)}  ${text(change.entity_type)} ${reference(change.record_id, ui)}`
        : `${text(change.type)}\t${text(change.entity_type)}\t${text(change.record_id)}`,
    );
    const fields = Array.isArray(change.changed_fields)
      ? change.changed_fields
      : [];
    for (const field of fields) {
      const item = object(field);
      if (item)
        ui.line(
          ui.rich
            ? `${ui.brand("│")}   ${ui.dim(text(item.field))}  ${text(item.before)} ${ui.dim("→")} ${text(item.after)}`
            : `${text(item.field)}: ${text(item.before)} -> ${text(item.after)}`,
        );
    }
  }
}

export function renderDeleted(
  value: unknown,
  ui: CliUi,
  subject: string,
): void {
  const result = object(value);
  if (result?.deleted === true) {
    const snapshot = text(result.snapshot_id);
    ui.success(
      snapshot
        ? ui.qualify(`Deleted ${subject}`, `snapshot ${ui.id(snapshot)}`)
        : `Deleted ${subject}`,
    );
  } else ui.info(`No ${subject} deleted`);
}

export function renderMigration(
  value: unknown,
  ui: CliUi,
  command: string,
): void {
  const result = object(value) ?? {};
  const data = object(result.status) ?? result;
  renderHeading(ui, "Migrations");
  renderPairs(ui, [
    ["Project", data.project_slug],
    ["Schema", `${text(data.current_version)} → ${text(data.latest_version)}`],
    ["Applied", Array.isArray(data.applied) ? data.applied.length : undefined],
    ["Pending", Array.isArray(data.pending) ? data.pending.length : undefined],
    ["Checksum", data.checksum_state],
  ]);
  const migrations = Array.isArray(result.migrations)
    ? result.migrations
    : command === "pending"
      ? Array.isArray(result.pending)
        ? result.pending
        : []
      : [];
  if (migrations.length)
    renderSection(ui, command === "pending" ? "Pending" : "Migrations", () => {
      for (const entry of migrations) {
        const migration = object(entry);
        if (migration)
          ui.line(
            `  ${text(migration.state) === "applied" ? ui.green("●") : ui.yellow("○")} ${text(migration.version)}  ${text(migration.name)}`,
          );
      }
    });
  const backups = Array.isArray(data.backup_paths) ? data.backup_paths : [];
  if (backups.length)
    renderSection(ui, "Backups", () => {
      for (const path of backups) ui.line(`  ${text(path)}`);
    });
  if (data.checksum_state === "invalid")
    ui.warn("Migration checksum is invalid.");
  if (Array.isArray(data.pending) && data.pending.length)
    ui.warn(`${data.pending.length} migration(s) pending.`);
}
