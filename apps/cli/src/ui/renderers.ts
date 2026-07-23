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

function heading(ui: CliUi, title: string): void {
  ui.line(ui.brand(title));
  ui.line();
}

function pairs(ui: CliUi, entries: Array<[string, unknown]>): void {
  const present = entries.filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  const width = Math.max(0, ...present.map(([name]) => name.length));
  for (const [name, value] of present)
    ui.line(`  ${ui.dim(name.padEnd(width))}  ${text(value)}`);
}

function section(ui: CliUi, title: string, draw: () => void): void {
  ui.line();
  ui.line(ui.brand(title));
  draw();
}

function empty(ui: CliUi): void {
  ui.line(ui.dim("(none)"));
}

function status(value: unknown, ui: CliUi): string {
  const rendered = text(value);
  if (rendered === "COMPLETED") return ui.green(rendered);
  if (rendered === "RUNNING") return ui.yellow(rendered);
  if (rendered === "CANCELLED") return ui.red(rendered);
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
  if (!data) return empty(ui);
  const counts = object(data.counts) ?? {};
  heading(ui, "VContext");
  pairs(ui, [
    ["Project", data.name],
    ["Slug", data.slug],
    ["Branch", ui.branch(text(data.current_branch))],
    ["Documents", counts.document],
    ["Tasks", counts.task],
    ["Changes", counts.change_note],
    ["File context", counts.file_context],
  ]);
  if (data.head_message)
    section(ui, "Last change", () => ui.line(`  ${text(data.head_message)}`));
  if (ui.options.verbose)
    section(ui, "Technical details", () =>
      pairs(ui, [
        ["Snapshot", reference(data.current_snapshot_id, ui)],
        ["Updated", timestamp(data.head_created_at)],
        ["Local path", data.local_path],
        ["Branches", data.branch_count],
      ]),
    );
}

export function renderProjects(value: unknown, ui: CliUi): void {
  if (!Array.isArray(value) || value.length === 0) return empty(ui);
  for (const item of value) {
    const project = object(item);
    if (!project) continue;
    ui.line(
      `${ui.brand(text(project.name))}  ${ui.dim(text(project.slug))}${project.description ? `  ${text(project.description)}` : ""}`,
    );
  }
}

export function renderEntityList(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
): void {
  if (!Array.isArray(value) || value.length === 0) return empty(ui);
  for (const item of value) {
    const record = object(item);
    if (!record) continue;
    const detail =
      entity === "task"
        ? `  ${status(record.status, ui)}`
        : entity === "file_context"
          ? `  ${ui.dim(text(record.kind))}`
          : "";
    ui.line(
      `${reference(record.record_id, ui)}  ${summary(record, entity)}${detail}`,
    );
  }
}

export function renderEntity(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
): void {
  const record = object(value);
  if (!record) return empty(ui);
  heading(ui, label[entity]);
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
  pairs(ui, main);
  if (ui.options.verbose)
    section(ui, "Technical details", () =>
      pairs(ui, [
        ["Revision", reference(record.id, ui)],
        ["Snapshot", reference(record.snapshot_id, ui)],
        ["Updated", timestamp(record.updated_at)],
        ["Created", timestamp(record.created_at)],
      ]),
    );
}

export function renderHistory(
  entity: EntityKind,
  value: unknown,
  ui: CliUi,
): void {
  if (!Array.isArray(value) || value.length === 0) return empty(ui);
  for (const item of value) {
    const record = object(item);
    if (!record) continue;
    ui.line(
      `${ui.dim(timestamp(record.updated_at))}  ${summary(record, entity)}  ${ui.dim("snapshot")} ${reference(record.snapshot_id, ui)}`,
    );
  }
}

export function renderBranches(
  value: unknown,
  ui: CliUi,
  current?: string,
): void {
  if (!Array.isArray(value) || value.length === 0) return empty(ui);
  for (const item of value) {
    const branch = object(item);
    if (!branch) continue;
    const name = text(branch.name);
    const marker = current === name ? ui.green("●") : " ";
    ui.line(
      `${marker} ${ui.branch(name)}  ${ui.dim("snapshot")} ${reference(branch.snapshot_id, ui)}`,
    );
  }
}

export function renderBranch(value: unknown, ui: CliUi, action?: string): void {
  const branch = object(value);
  if (!branch) return empty(ui);
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
  heading(ui, "Branch");
  pairs(ui, [
    ["Name", ui.branch(text(branch.name))],
    ["Snapshot", reference(branch.snapshot_id, ui)],
  ]);
  if (ui.options.verbose)
    pairs(ui, [
      ["Updated", timestamp(branch.updated_at)],
      ["Created", timestamp(branch.created_at)],
    ]);
}

export function renderSnapshots(value: unknown, ui: CliUi): void {
  if (!Array.isArray(value) || value.length === 0) return empty(ui);
  for (const item of value) {
    const snapshot = object(item);
    if (!snapshot) continue;
    const branches = Array.isArray(snapshot.branch_labels)
      ? snapshot.branch_labels.map(text).join(", ")
      : "";
    ui.line(
      `${reference(snapshot.id, ui)}  ${ui.dim(timestamp(snapshot.created_at))}${branches ? `  ${ui.branch(branches)}` : ""}${snapshot.message ? `  ${text(snapshot.message)}` : ""}`,
    );
  }
}

export function renderSnapshot(value: unknown, ui: CliUi): void {
  const snapshot = object(value);
  if (!snapshot) return empty(ui);
  heading(ui, "Snapshot");
  pairs(ui, [
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
    section(ui, "Contents", () =>
      pairs(ui, [
        ["Documents", counts.document],
        ["Tasks", counts.task],
        ["Changes", counts.change_note],
        ["File context", counts.file_context],
      ]),
    );
}

export function renderDiff(value: unknown, ui: CliUi): void {
  const diff = object(value);
  if (!diff) return empty(ui);
  heading(
    ui,
    `Diff ${text(diff.from_snapshot_id)} → ${text(diff.to_snapshot_id)}`,
  );
  const changes = Array.isArray(diff.changes) ? diff.changes : [];
  if (changes.length === 0) return empty(ui);
  for (const entry of changes) {
    const change = object(entry);
    if (!change) continue;
    ui.line(
      `${status(change.type, ui)}  ${text(change.entity_type)} ${reference(change.record_id, ui)}`,
    );
    const fields = Array.isArray(change.changed_fields)
      ? change.changed_fields
      : [];
    for (const field of fields) {
      const item = object(field);
      if (item)
        ui.line(
          `  ${ui.dim(text(item.field))}  ${text(item.before)} ${ui.dim("→")} ${text(item.after)}`,
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
  if (result?.deleted === true) ui.success(`Deleted ${subject}`);
  else ui.info(`No ${subject} deleted`);
}

export function renderMigration(
  value: unknown,
  ui: CliUi,
  command: string,
): void {
  const result = object(value) ?? {};
  const data = object(result.status) ?? result;
  heading(ui, "Migrations");
  pairs(ui, [
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
    section(ui, command === "pending" ? "Pending" : "Migrations", () => {
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
    section(ui, "Backups", () => {
      for (const path of backups) ui.line(`  ${text(path)}`);
    });
  if (data.checksum_state === "invalid")
    ui.warn("Migration checksum is invalid.");
  if (Array.isArray(data.pending) && data.pending.length)
    ui.warn(`${data.pending.length} migration(s) pending.`);
}
