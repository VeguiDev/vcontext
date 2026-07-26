import { z } from "zod";
import type { VContextAPI } from "./api.js";
import {
  InputSchemaChangesAdd,
  InputSchemaChangesList,
  InputSchemaContext,
  InputSchemaLinksAdd,
  InputSchemaLinksList,
  InputSchemaLinksRemove,
  InputSchemaMigrationList,
  InputSchemaMigrationStatus,
  InputSchemaDocumentsAdd,
  InputSchemaDocumentsDelete,
  InputSchemaDocumentsGet,
  InputSchemaDocumentsList,
  InputSchemaDocumentsUpdate,
  InputSchemaFileContextDelete,
  InputSchemaFileContextList,
  InputSchemaFileContextUpsert,
  InputSchemaOutsideLinksAdd,
  InputSchemaOutsideLinksDelete,
  InputSchemaOutsideLinksGet,
  InputSchemaOutsideLinksList,
  InputSchemaOutsideLinksUpdate,
  InputSchemaProjects,
  InputSchemaPromptsAdd,
  InputSchemaPromptsDelete,
  InputSchemaPromptsList,
  InputSchemaPromptsUpdate,
  InputSchemaTasksAdd,
  InputSchemaTasksDelete,
  InputSchemaTasksList,
  InputSchemaTasksUpdate,
  ProjectPropertiesSchema,
  ReadPropertiesSchema,
  WritePropertiesSchema,
  canonicalProject,
  canonicalId,
} from "./schemas.js";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

function content(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

// allow: SIZE_OK — MCP tool definitions form one protocol registry.
export function createToolDefinitions(api: VContextAPI): ToolDefinition[] {
  const legacy: ToolDefinition[] = [
    {
      name: "vcontext_context",
      description:
        "Get compact project context for AI agents. Omits usage instructions and CLI reference, truncates documents, caps changes at 5.",
      inputSchema: InputSchemaContext,
      handler: async (args) => {
        const parsed = InputSchemaContext.parse(args);
        return content(await api.renderContext(parsed.slug, { compact: true }));
      },
    },
    {
      name: "vcontext_projects",
      description: "List all registered vcontext projects.",
      inputSchema: InputSchemaProjects,
      handler: async (args) => {
        InputSchemaProjects.parse(args);
        return content(await api.listProjects());
      },
    },
    {
      name: "vcontext_migration_status",
      description:
        "Inspect the current, latest, applied, pending, checksum, post-migration, and backup state for a project.",
      inputSchema: InputSchemaMigrationStatus,
      handler: async (args) => {
        const parsed = InputSchemaMigrationStatus.parse(args);
        return content(await api.migrationStatus(parsed.slug));
      },
    },
    {
      name: "vcontext_migration_list",
      description:
        "List available project migrations and whether each is applied or pending.",
      inputSchema: InputSchemaMigrationList,
      handler: async (args) => {
        const parsed = InputSchemaMigrationList.parse(args);
        return content(await api.migrationList(parsed.slug));
      },
    },
    {
      name: "vcontext_tasks_list",
      description: "List tasks for a project.",
      inputSchema: InputSchemaTasksList,
      handler: async (args) => {
        const parsed = InputSchemaTasksList.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityList("task", read(parsed), parsed.status),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.tasks.list());
      },
    },
    {
      name: "vcontext_tasks_add",
      description: "Add a task to a project.",
      inputSchema: InputSchemaTasksAdd,
      handler: async (args) => {
        const parsed = InputSchemaTasksAdd.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityAdd(
              "task",
              fields(parsed, ["title", "description", "document_id", "status"]),
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.tasks.add({
            title: parsed.title,
            description: parsed.description,
            status: parsed.status,
          }),
        );
      },
    },
    {
      name: "vcontext_tasks_update",
      description: "Update a task in a project.",
      inputSchema: InputSchemaTasksUpdate,
      handler: async (args) => {
        const parsed = InputSchemaTasksUpdate.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityUpdate(
              "task",
              parsed.taskId,
              fields(parsed, ["title", "description", "document_id", "status"]),
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.tasks.update(parsed.taskId, {
            title: parsed.title,
            description: parsed.description,
            status: parsed.status,
          }),
        );
      },
    },
    {
      name: "vcontext_tasks_delete",
      description: "Delete a task from a project.",
      inputSchema: InputSchemaTasksDelete,
      handler: async (args) => {
        const parsed = InputSchemaTasksDelete.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityDelete("task", parsed.taskId, write(parsed)),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.tasks.delete(parsed.taskId));
      },
    },
    {
      name: "vcontext_documents_list",
      description: "List documents for a project.",
      inputSchema: InputSchemaDocumentsList,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsList.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(await api.entityList("document", read(parsed)));
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.documents.list());
      },
    },
    {
      name: "vcontext_documents_get",
      description: "Get a project document by ID.",
      inputSchema: InputSchemaDocumentsGet,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsGet.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityGet("document", parsed.documentId, read(parsed)),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.documents.get(parsed.documentId));
      },
    },
    {
      name: "vcontext_documents_add",
      description: "Add a document to a project.",
      inputSchema: InputSchemaDocumentsAdd,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsAdd.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityAdd(
              "document",
              fields(parsed, ["title", "content"]),
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.documents.add({
            title: parsed.title,
            content: parsed.content,
          }),
        );
      },
    },
    {
      name: "vcontext_documents_update",
      description: "Update a document in a project.",
      inputSchema: InputSchemaDocumentsUpdate,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsUpdate.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityUpdate(
              "document",
              parsed.documentId,
              fields(parsed, ["title", "content"]),
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.documents.update(parsed.documentId, {
            title: parsed.title,
            content: parsed.content,
          }),
        );
      },
    },
    {
      name: "vcontext_documents_delete",
      description: "Delete a document from a project.",
      inputSchema: InputSchemaDocumentsDelete,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsDelete.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityDelete(
              "document",
              parsed.documentId,
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.documents.delete(parsed.documentId));
      },
    },
    {
      name: "vcontext_changes_list",
      description: "List changes recorded for a project.",
      inputSchema: InputSchemaChangesList,
      handler: async (args) => {
        const parsed = InputSchemaChangesList.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(await api.entityList("change_note", read(parsed)));
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.changes.list());
      },
    },
    {
      name: "vcontext_changes_add",
      description: "Record a change for a project.",
      inputSchema: InputSchemaChangesAdd,
      handler: async (args) => {
        const parsed = InputSchemaChangesAdd.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityAdd(
              "change_note",
              fields(parsed, ["note", "document_id"]),
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.changes.add({
            note: parsed.note,
            document_id: parsed.document_id,
          }),
        );
      },
    },
    {
      name: "vcontext_file_context_list",
      description: "List file context entries for a project.",
      inputSchema: InputSchemaFileContextList,
      handler: async (args) => {
        const parsed = InputSchemaFileContextList.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(await api.entityList("file_context", read(parsed)));
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.fileContexts.list());
      },
    },
    {
      name: "vcontext_file_context_upsert",
      description: "Create or update a file context entry for a project.",
      inputSchema: InputSchemaFileContextUpsert,
      handler: async (args) => {
        const parsed = InputSchemaFileContextUpsert.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.fileContextUpsert(
              fields(parsed, [
                "path",
                "description",
                "kind",
                "filename",
                "hash",
              ]),
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.fileContexts.upsert({
            path: parsed.path,
            description: parsed.description,
            kind: parsed.kind,
            filename: parsed.filename,
            hash: parsed.hash,
          }),
        );
      },
    },
    {
      name: "vcontext_file_context_delete",
      description: "Delete a file context entry from a project.",
      inputSchema: InputSchemaFileContextDelete,
      handler: async (args) => {
        const parsed = InputSchemaFileContextDelete.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityDelete(
              "file_context",
              parsed.fileContextId,
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.fileContexts.delete(parsed.fileContextId));
      },
    },
    {
      name: "vcontext_prompts_list",
      description: "List prompts for a project.",
      inputSchema: InputSchemaPromptsList,
      handler: async (args) => {
        const parsed = InputSchemaPromptsList.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(await api.entityList("project_prompt", read(parsed)));
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.prompts.list());
      },
    },
    {
      name: "vcontext_prompts_add",
      description: "Add a prompt to a project.",
      inputSchema: InputSchemaPromptsAdd,
      handler: async (args) => {
        const parsed = InputSchemaPromptsAdd.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityAdd(
              "project_prompt",
              { prompt: parsed.prompt },
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.prompts.add({ prompt: parsed.prompt }));
      },
    },
    {
      name: "vcontext_prompts_update",
      description: "Update a prompt in a project.",
      inputSchema: InputSchemaPromptsUpdate,
      handler: async (args) => {
        const parsed = InputSchemaPromptsUpdate.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityUpdate(
              "project_prompt",
              parsed.promptId,
              { prompt: parsed.prompt },
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(
          await project.prompts.update(parsed.promptId, {
            prompt: parsed.prompt,
          }),
        );
      },
    },
    {
      name: "vcontext_prompts_delete",
      description: "Delete a prompt from a project.",
      inputSchema: InputSchemaPromptsDelete,
      handler: async (args) => {
        const parsed = InputSchemaPromptsDelete.parse(args);
        if (typeof api.projectStatus === "function") {
          return content(
            await api.entityDelete(
              "project_prompt",
              parsed.promptId,
              write(parsed),
            ),
          );
        }
        const project = await api.getProject(parsed.slug);
        return content(await project.prompts.delete(parsed.promptId));
      },
    },
    {
      name: "vcontext_links_list",
      description: "List links for a project.",
      inputSchema: InputSchemaLinksList,
      handler: async (args) => {
        const parsed = InputSchemaLinksList.parse(args);
        return content(await api.linksList(project(parsed)));
      },
    },
    {
      name: "vcontext_links_add",
      description: "Create a link to another project.",
      inputSchema: InputSchemaLinksAdd,
      handler: async (args) => {
        const parsed = InputSchemaLinksAdd.parse(args);
        return content(
          await api.linksAdd(
            project(parsed),
            parsed.project_b_slug,
            parsed.branch_name,
            parsed.snapshot_id,
          ),
        );
      },
    },
    {
      name: "vcontext_links_remove",
      description: "Remove a link to another project.",
      inputSchema: InputSchemaLinksRemove,
      handler: async (args) => {
        const parsed = InputSchemaLinksRemove.parse(args);
        return content(
          await api.linksRemove(
            project(parsed),
            parsed.project_b_slug,
            parsed.branch_name,
            parsed.snapshot_id,
          ),
        );
      },
    },
  ];
  const definitions =
    typeof api.projectStatus === "function"
      ? [...legacy, ...createVersioningToolDefinitions(api)]
      : legacy;
  return definitions.map(wrapTool);
}

const recordSelectorSchema = ReadPropertiesSchema.safeExtend({
  record_id: z.string().min(1).optional(),
  documentId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  changeId: z.string().min(1).optional(),
  fileContextId: z.string().min(1).optional(),
  promptId: z.string().min(1).optional(),
});

const documentUpdateFields = {
  title: z.string().min(1).optional(),
  content: z.string().optional(),
};
const changeUpdateFields = {
  note: z.string().min(1).optional(),
  document_id: z.string().min(1).nullable().optional(),
};
const fileFields = {
  path: z.string().min(1).optional(),
  description: z.string().optional(),
  kind: z.enum(["file", "directory", "path"]).optional(),
  filename: z.string().min(1).optional(),
  hash: z.string().min(1).optional(),
};

function createVersioningToolDefinitions(api: VContextAPI): ToolDefinition[] {
  const definitions: ToolDefinition[] = [
    tool(
      "vcontext_project_status",
      "Get stable project, branch, snapshot, path, and visible entity counts.",
      ProjectPropertiesSchema,
      async (value) => api.projectStatus(project(value)),
    ),
  ];

  definitions.push(
    entityGetTool(api, "task", "tasks", "taskId"),
    entityHistoryTool(api, "task", "tasks", "taskId"),
    entityHistoryTool(api, "document", "documents", "documentId"),
    entityGetTool(api, "change_note", "changes", "changeId"),
    entityUpdateTool(
      api,
      "change_note",
      "changes",
      "changeId",
      changeUpdateFields,
    ),
    entityDeleteTool(api, "change_note", "changes", "changeId"),
    entityHistoryTool(api, "change_note", "changes", "changeId"),
    entityGetTool(api, "file_context", "file_context", "fileContextId"),
    tool(
      "vcontext_file_context_add",
      "Add a distinct file context record.",
      WritePropertiesSchema.safeExtend({
        path: z.string().min(1),
        description: z.string(),
        kind: z.enum(["file", "directory", "path"]).optional(),
        filename: z.string().min(1).optional(),
        hash: z.string().min(1).optional(),
      }),
      async (value) =>
        api.entityAdd(
          "file_context",
          fields(value, Object.keys(fileFields)),
          write(value),
        ),
    ),
    entityUpdateTool(
      api,
      "file_context",
      "file_context",
      "fileContextId",
      fileFields,
    ),
    entityHistoryTool(api, "file_context", "file_context", "fileContextId"),
    tool(
      "vcontext_file_context_get_by_path",
      "Get file context by its business path.",
      ReadPropertiesSchema.safeExtend({ path: z.string().min(1) }),
      async (value) => api.fileContextByPath(String(value.path), read(value)),
    ),
    entityHistoryTool(api, "project_prompt", "prompts", "promptId"),
    tool(
      "vcontext_outside_links_list",
      "List outside links for a project.",
      InputSchemaOutsideLinksList,
      async (value) =>
        api.outsideLinksList(
          read(value),
          value.source_file_context_id as string | undefined,
        ),
    ),
    tool(
      "vcontext_outside_links_add",
      "Add an outside link to a project.",
      InputSchemaOutsideLinksAdd,
      async (value) =>
        api.outsideLinksAdd(
          fields(value, [
            "source_file_context_id",
            "target_project_slug",
            "target_path",
            "target_type",
            "target_branch_name",
            "target_snapshot_id",
            "kind",
            "description",
          ]),
          write(value),
        ),
    ),
    tool(
      "vcontext_outside_links_get",
      "Get an outside link by record ID.",
      InputSchemaOutsideLinksGet,
      async (value) =>
        api.outsideLinksGet(String(value.record_id), read(value)),
    ),
    tool(
      "vcontext_outside_links_update",
      "Update an outside link.",
      InputSchemaOutsideLinksUpdate,
      async (value) =>
        api.outsideLinksUpdate(
          String(value.record_id),
          fields(value, [
            "source_file_context_id",
            "target_project_slug",
            "target_path",
            "target_type",
            "target_branch_name",
            "target_snapshot_id",
            "kind",
            "description",
          ]),
          write(value),
        ),
    ),
    tool(
      "vcontext_outside_links_delete",
      "Delete an outside link.",
      InputSchemaOutsideLinksDelete,
      async (value) =>
        api.outsideLinksDelete(String(value.record_id), write(value)),
    ),
  );

  const namedBranch = ProjectPropertiesSchema.safeExtend({
    name: z.string().min(1),
  });
  definitions.push(
    tool(
      "vcontext_branches_list",
      "List project branches.",
      ProjectPropertiesSchema,
      async (value) => api.branchList(project(value)),
    ),
    tool(
      "vcontext_branches_current",
      "Get the currently checked out branch.",
      ProjectPropertiesSchema,
      async (value) => api.branchCurrent(project(value)),
    ),
    tool(
      "vcontext_branches_create",
      "Create a branch from a branch or snapshot reference.",
      namedBranch.safeExtend({ from: z.string().min(1).optional() }),
      async (value) =>
        api.branchCreate(
          String(value.name),
          value.from as string | undefined,
          project(value),
        ),
    ),
    tool(
      "vcontext_branches_checkout",
      "Select an existing branch for subsequent default operations.",
      namedBranch,
      async (value) => api.branchCheckout(String(value.name), project(value)),
    ),
    tool(
      "vcontext_branches_rename",
      "Rename a branch.",
      namedBranch.safeExtend({ new_name: z.string().min(1) }),
      async (value) =>
        api.branchRename(
          String(value.name),
          String(value.new_name),
          project(value),
        ),
    ),
    tool(
      "vcontext_branches_delete",
      "Delete a non-current branch.",
      namedBranch,
      async (value) => api.branchDelete(String(value.name), project(value)),
    ),
  );

  const snapshotSchema = ProjectPropertiesSchema.safeExtend({
    snapshot_id: z.string().min(1),
  });
  definitions.push(
    tool(
      "vcontext_snapshots_list",
      "List reachable snapshots, newest first, with parents and labels.",
      ReadPropertiesSchema.safeExtend({
        limit: z.number().int().min(1).max(500).optional(),
      }),
      async (value) =>
        api.snapshotList(read(value), value.limit as number | undefined),
    ),
    tool(
      "vcontext_snapshots_diff",
      "Diff business fields between a source reference and a snapshot.",
      snapshotSchema.safeExtend({ from: z.string().min(1).optional() }),
      async (value) =>
        api.snapshotDiff(
          String(value.snapshot_id),
          value.from as string | undefined,
          project(value),
        ),
    ),
    tool(
      "vcontext_snapshots_checkout",
      "Create and select a branch at a snapshot; detached writes are never used.",
      snapshotSchema.safeExtend({ branch: z.string().min(1) }),
      async (value) =>
        api.snapshotCheckout(
          String(value.snapshot_id),
          String(value.branch),
          project(value),
        ),
    ),
    tool(
      "vcontext_log",
      "Show reachable snapshot history, newest first.",
      ReadPropertiesSchema.safeExtend({
        limit: z.number().int().min(1).max(500).optional(),
      }),
      async (value) => api.log(read(value), value.limit as number | undefined),
    ),
  );

  const mergeSchema = ProjectPropertiesSchema.safeExtend({
    source_branch: z.string().min(1),
    target_branch: z.string().min(1).optional(),
  });
  definitions.push(
    tool(
      "vcontext_merge_preview",
      "Preview a three-way branch merge and its conflicts.",
      mergeSchema,
      async (value) =>
        api.mergePreview(
          String(value.source_branch),
          value.target_branch as string | undefined,
          project(value),
        ),
    ),
    tool(
      "vcontext_merge_apply",
      "Apply a merge with manual, source, or target conflict strategy.",
      mergeSchema.safeExtend({
        strategy: z.enum(["manual", "source", "target"]).optional(),
        resolutions: z.record(z.string(), z.unknown()).optional(),
        message: z.string().nullable().optional(),
      }),
      async (value) =>
        api.mergeApply({
          ...project(value),
          source_branch: String(value.source_branch),
          target_branch: value.target_branch as string | undefined,
          strategy: value.strategy as
            | "manual"
            | "source"
            | "target"
            | undefined,
          resolutions: value.resolutions as Record<string, unknown> | undefined,
          message: value.message as string | null | undefined,
        }),
    ),
  );

  return definitions;
}

function entityGetTool(
  api: VContextAPI,
  entity: import("./api.js").EntityName,
  plural: string,
  legacyId: string,
): ToolDefinition {
  return tool(
    `vcontext_${plural}_get`,
    `Get one ${entity} by public record_id.`,
    recordSelectorSchema,
    async (value) => api.entityGet(entity, id(value, legacyId), read(value)),
  );
}

function entityHistoryTool(
  api: VContextAPI,
  entity: import("./api.js").EntityName,
  plural: string,
  legacyId: string,
): ToolDefinition {
  return tool(
    `vcontext_${plural}_history`,
    `List reachable revisions for one ${entity}, oldest first.`,
    recordSelectorSchema,
    async (value) =>
      api.entityHistory(entity, id(value, legacyId), read(value)),
  );
}

function entityUpdateTool(
  api: VContextAPI,
  entity: import("./api.js").EntityName,
  plural: string,
  legacyId: string,
  updateFields: Record<string, z.ZodTypeAny>,
): ToolDefinition {
  return tool(
    `vcontext_${plural}_update`,
    `Update one ${entity} and create a snapshot.`,
    WritePropertiesSchema.safeExtend({
      record_id: z.string().min(1).optional(),
      [legacyId]: z.string().min(1).optional(),
      ...updateFields,
    }),
    async (value) =>
      api.entityUpdate(
        entity,
        id(value, legacyId),
        fields(value, Object.keys(updateFields)),
        write(value),
      ),
  );
}

function entityDeleteTool(
  api: VContextAPI,
  entity: import("./api.js").EntityName,
  plural: string,
  legacyId: string,
): ToolDefinition {
  return tool(
    `vcontext_${plural}_delete`,
    `Delete one ${entity} by creating a tombstone revision.`,
    WritePropertiesSchema.safeExtend({
      record_id: z.string().min(1).optional(),
      [legacyId]: z.string().min(1).optional(),
    }),
    async (value) =>
      api.entityDelete(entity, id(value, legacyId), write(value)),
  );
}

function tool(
  name: string,
  description: string,
  inputSchema: z.ZodTypeAny,
  action: (value: Record<string, unknown>) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    handler: async (args) =>
      content(await action(inputSchema.parse(args) as Record<string, unknown>)),
  };
}

function project(value: Record<string, unknown>) {
  return canonicalProject(value as never);
}

function read(value: Record<string, unknown>) {
  return {
    ...project(value),
    branch: value.branch as string | undefined,
    snapshot_id: value.snapshot_id as string | undefined,
  };
}

function write(value: Record<string, unknown>) {
  if (value.snapshot_id !== undefined) {
    throw new Error("Writes cannot target snapshot_id");
  }
  return {
    ...project(value),
    branch: value.branch as string | undefined,
    message: value.message as string | null | undefined,
  };
}

function id(value: Record<string, unknown>, legacyName: string) {
  return canonicalId(
    value.record_id as string | undefined,
    value[legacyName] as string | undefined,
  );
}

function fields(value: Record<string, unknown>, names: string[]) {
  return Object.fromEntries(
    names
      .filter((name) => value[name] !== undefined)
      .map((name) => [name, value[name]]),
  );
}

function wrapTool(definition: ToolDefinition): ToolDefinition {
  return {
    ...definition,
    handler: async (args) => {
      try {
        return await definition.handler(
          normalizeLegacyArgs(definition.name, args),
        );
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown };
        const code =
          typeof candidate.code === "string"
            ? candidate.code
            : error instanceof z.ZodError
              ? "VALIDATION_ERROR"
              : "VALIDATION_ERROR";
        const message =
          typeof candidate.message === "string"
            ? candidate.message.replace(
                /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*/i,
                "Database operation failed",
              )
            : "vcontext operation failed";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ isError: true, code, message }),
            },
          ],
        };
      }
    },
  };
}

function normalizeLegacyArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...args };
  if (
    typeof normalized.project_slug === "string" &&
    normalized.slug === undefined
  ) {
    normalized.slug = normalized.project_slug;
  }
  const legacyByTool: Array<[RegExp, string]> = [
    [/documents_(?:get|update|delete)$/, "documentId"],
    [/tasks_(?:get|update|delete)$/, "taskId"],
    [/changes_(?:get|update|delete)$/, "changeId"],
    [/file_context_(?:get|update|delete)$/, "fileContextId"],
    [/prompts_(?:get|update|delete)$/, "promptId"],
  ];
  const match = legacyByTool.find(([pattern]) => pattern.test(name));
  if (match && typeof normalized.record_id === "string") {
    const legacy = normalized[match[1]];
    if (typeof legacy === "string" && legacy !== normalized.record_id) {
      throw new Error("record_id contradicts its legacy ID field");
    }
    normalized[match[1]] = normalized.record_id;
  }
  return normalized;
}
