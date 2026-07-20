import type { ProjectStore } from "../storage/project-store.js";

export function renderProjectContext(
  project: ProjectStore,
  opts?: { compact?: boolean; branch?: string; snapshot_id?: string },
) {
  const { compact = false } = opts ?? {};
  const branch = opts?.snapshot_id
    ? project.snapshot(opts.snapshot_id)
    : project.branch(opts?.branch);
  const prompts = branch.prompt.find();
  const documents = branch.document.find();
  const changes = branch.change.find().slice(0, compact ? 5 : 20);
  const tasks = branch.task
    .find()
    .filter(
      (task) => task.status !== "COMPLETED" && task.status !== "CANCELLED",
    );
  const pathContexts = branch.fileContext.find();

  return [
    `Project: ${project.project.name}`,
    `Slug: ${project.project.slug}`,
    "",
    ...(compact
      ? []
      : [
          "How to use this context:",
          "- This tool stores durable context for you and for other agents working on the same project.",
          "- Treat documents as project-level memory written for AI agents.",
          "- Treat path context as a summary of relevant files or directories in the local repository.",
          "- Use documents to explain architecture, workflows, decisions, and important areas of the repo.",
          "- Use path context to describe relevant files or directories when that helps future navigation.",
          "- When you start or continue work, create or update tasks so other agents can see current intent.",
          "- When you make meaningful changes, add a change note and update stale documents.",
          "- Write context in the language that is most useful for future agents. It can be concise English and does not need to read like human-facing documentation.",
          "- If you are running inside this project directory, you can omit the project slug.",
          "",
          "CLI quick reference:",
          `- Read this context: vcontext give-context ${project.project.slug}`,
          `- Read this context as JSON: vcontext give-context ${project.project.slug} --json`,
          `- List documents: vcontext doc list ${project.project.slug}`,
          `- Add a document: vcontext doc add ${project.project.slug} --title "Title" --content "Content"`,
          `- List active tasks: vcontext task list ${project.project.slug}`,
          `- Add a task: vcontext task add ${project.project.slug} --title "Task title" --description "Task details"`,
          `- Add a change note: vcontext change add ${project.project.slug} --note "What changed"`,
          `- Upsert path context: vcontext file-context upsert ${project.project.slug} --path "relative/path" --kind directory --description "What this path contains"`,
          "",
        ]),
    "Project prompts:",
    prompts.length === 0
      ? "- No project prompts yet."
      : prompts.map((entry) => `- ${entry.prompt}`).join("\n"),
    "",
    "Active tasks:",
    tasks.length === 0
      ? "- No active tasks."
      : tasks
          .map(
            (task) =>
              `- [${task.status}] ${task.title}${
                task.description ? `: ${task.description}` : ""
              }`,
          )
          .join("\n"),
    "",
    "Recent changes:",
    changes.length === 0
      ? "- No change notes yet."
      : changes.map((change) => `- ${change.note}`).join("\n"),
    "",
    "Documents:",
    documents.length === 0
      ? "- No documents yet."
      : documents
          .map((doc) =>
            [
              `## ${doc.title}`,
              compact
                ? doc.content.trim().slice(0, 80) +
                  (doc.content.length > 80 ? "..." : "")
                : doc.content.trim(),
            ].join("\n"),
          )
          .join("\n\n"),
    "",
    "Path context:",
    pathContexts.length === 0
      ? "- No path context yet."
      : pathContexts
          .map(
            (entry) => `- [${entry.kind}] ${entry.path}: ${entry.description}`,
          )
          .join("\n"),
  ].join("\n");
}
