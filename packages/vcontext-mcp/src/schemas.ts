import { z } from "zod";

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  paths: z
    .array(
      z.object({
        type: z.enum(["local", "remote"]),
        path: z.string().min(1),
        label: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export const LinkProjectSchema = z.object({
  project_b_slug: z.string().min(1),
  branch_name: z.string().optional(),
  snapshot_id: z.string().optional(),
});

export const ProjectPathSchema = z.object({
  type: z.enum(["local", "remote"]),
  path: z.string().min(1),
  label: z.string().nullable().optional(),
});

export const ProjectPromptSchema = z.object({
  prompt: z.string().min(1),
});

export const CreateDocumentSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
});

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
});

export const CreateChangeSchema = z.object({
  note: z.string().min(1),
  document_id: z.string().min(1).nullable().optional(),
});

export const TaskStatusSchema = z.enum([
  "BACKLOG",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
]);

export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  document_id: z.string().min(1).nullable().optional(),
  status: TaskStatusSchema.optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  document_id: z.string().min(1).nullable().optional(),
  status: TaskStatusSchema.optional(),
});

export const UpsertFileContextSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["file", "directory", "path"]).optional(),
  filename: z.string().min(1).optional(),
  hash: z.string().min(1).optional(),
  description: z.string(),
});

export function parseId(value: string) {
  return z.string().min(1).parse(value);
}

export const ProjectPropertiesSchema = z
  .object({
    project_slug: z.string().optional().describe("Canonical project slug"),
    slug: z
      .string()
      .optional()
      .describe("Project slug (optional if cwd resolves)"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory for slug auto-resolution"),
  })
  .superRefine((value, context) => {
    if (value.project_slug && value.slug && value.project_slug !== value.slug) {
      context.addIssue({
        code: "custom",
        message: "project_slug and legacy slug contradict each other",
        path: ["project_slug"],
      });
    }
  });

export const ReadPropertiesSchema = ProjectPropertiesSchema.safeExtend({
  branch: z.string().min(1).optional(),
  snapshot_id: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.branch && value.snapshot_id) {
    context.addIssue({
      code: "custom",
      message: "branch and snapshot_id are mutually exclusive",
      path: ["snapshot_id"],
    });
  }
});

export const WritePropertiesSchema = ProjectPropertiesSchema.safeExtend({
  branch: z.string().min(1).optional(),
  message: z.string().nullable().optional(),
});

export function canonicalProject(value: {
  project_slug?: string;
  slug?: string;
  cwd?: string;
}) {
  return {
    project_slug: value.project_slug ?? value.slug,
    cwd: value.cwd,
  };
}

export function canonicalId(
  canonical: string | undefined,
  legacy: string | undefined,
  canonicalName = "record_id",
) {
  if (canonical && legacy && canonical !== legacy) {
    throw new Error(`${canonicalName} contradicts its legacy ID field`);
  }
  const value = canonical ?? legacy;
  if (!value) throw new Error(`${canonicalName} is required`);
  return value;
}

export const InputSchemaContext = ProjectPropertiesSchema;

export const InputSchemaProjects = ProjectPropertiesSchema;

export const InputSchemaMigrationStatus = ProjectPropertiesSchema;

export const InputSchemaMigrationList = ProjectPropertiesSchema;

export const InputSchemaTasksList = ReadPropertiesSchema.safeExtend({
  status: TaskStatusSchema.optional(),
});

export const InputSchemaTasksAdd = WritePropertiesSchema.safeExtend({
  title: z.string().describe("Task title"),
  description: z.string().optional().describe("Task description"),
  document_id: z.string().nullable().optional(),
  status: TaskStatusSchema.optional().describe("Task status"),
});

export const InputSchemaTasksUpdate = WritePropertiesSchema.safeExtend({
  taskId: z.string().describe("Task record ID"),
  title: z.string().optional().describe("Task title"),
  description: z.string().nullable().optional().describe("Task description"),
  document_id: z.string().nullable().optional(),
  status: TaskStatusSchema.optional().describe("Task status"),
});

export const InputSchemaTasksDelete = WritePropertiesSchema.safeExtend({
  taskId: z.string().describe("Task record ID"),
});

export const InputSchemaDocumentsList = ReadPropertiesSchema;

export const InputSchemaDocumentsGet = ReadPropertiesSchema.safeExtend({
  documentId: z.string().describe("Document record ID"),
});

export const InputSchemaDocumentsAdd = WritePropertiesSchema.safeExtend({
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content"),
});

export const InputSchemaDocumentsUpdate = WritePropertiesSchema.safeExtend({
  documentId: z.string().describe("Document record ID"),
  title: z.string().optional().describe("Document title"),
  content: z.string().optional().describe("Document content"),
});

export const InputSchemaDocumentsDelete = WritePropertiesSchema.safeExtend({
  documentId: z.string().describe("Document record ID"),
});

export const InputSchemaChangesList = ReadPropertiesSchema;

export const InputSchemaChangesAdd = WritePropertiesSchema.safeExtend({
  note: z.string().describe("Change note"),
  document_id: z.string().optional().describe("Related document record ID"),
});

export const InputSchemaFileContextList = ReadPropertiesSchema;

export const InputSchemaFileContextUpsert = WritePropertiesSchema.safeExtend({
  path: z.string().describe("File or directory path"),
  description: z.string().describe("Context description"),
  kind: z
    .enum(["file", "directory", "path"])
    .optional()
    .describe("Context path kind"),
  filename: z.string().optional().describe("File name"),
  hash: z.string().optional().describe("Content hash"),
});

export const InputSchemaFileContextDelete = WritePropertiesSchema.safeExtend({
  fileContextId: z.string().describe("File context record ID"),
});

export const InputSchemaPromptsList = ReadPropertiesSchema;

export const InputSchemaPromptsAdd = WritePropertiesSchema.safeExtend({
  prompt: z.string().describe("Prompt text"),
});

export const InputSchemaPromptsUpdate = WritePropertiesSchema.safeExtend({
  promptId: z.string().describe("Prompt record ID"),
  prompt: z.string().describe("Prompt text"),
});

export const InputSchemaPromptsDelete = WritePropertiesSchema.safeExtend({
  promptId: z.string().describe("Prompt record ID"),
});

export const FileOutsideLinkKindEnum = z.enum([
  "lib",
  "sdk",
  "api",
  "dependency",
  "external_call",
  "import",
]);

export const FileOutsideLinkTargetTypeEnum = z.enum([
  "file",
  "directory",
  "project",
]);

export const InputSchemaOutsideLinksList = ReadPropertiesSchema.safeExtend({
  source_file_context_id: z
    .string()
    .optional()
    .describe("Filter by source file context record ID"),
});

export const InputSchemaOutsideLinksAdd = WritePropertiesSchema.safeExtend({
  source_file_context_id: z
    .string()
    .nullable()
    .optional()
    .describe("Source file context record ID"),
  target_project_slug: z.string().min(1).describe("Target project slug"),
  target_path: z
    .string()
    .nullable()
    .optional()
    .describe("Target file or directory path"),
  target_type: FileOutsideLinkTargetTypeEnum.optional().describe(
    "Target type: file, directory, or project",
  ),
  target_branch_name: z
    .string()
    .nullable()
    .optional()
    .describe("Target branch name"),
  target_snapshot_id: z
    .string()
    .nullable()
    .optional()
    .describe("Target snapshot ID"),
  kind: FileOutsideLinkKindEnum.optional().describe("Link kind"),
  description: z.string().min(1).describe("Link description"),
});

export const InputSchemaOutsideLinksGet = ReadPropertiesSchema.safeExtend({
  record_id: z.string().min(1).describe("Outside link record ID"),
});

export const InputSchemaOutsideLinksUpdate = WritePropertiesSchema.safeExtend({
  record_id: z.string().min(1).describe("Outside link record ID"),
  source_file_context_id: z
    .string()
    .nullable()
    .optional()
    .describe("Source file context record ID"),
  target_project_slug: z
    .string()
    .min(1)
    .optional()
    .describe("Target project slug"),
  target_path: z
    .string()
    .nullable()
    .optional()
    .describe("Target file or directory path"),
  target_type: FileOutsideLinkTargetTypeEnum.optional().describe(
    "Target type: file, directory, or project",
  ),
  target_branch_name: z
    .string()
    .nullable()
    .optional()
    .describe("Target branch name"),
  target_snapshot_id: z
    .string()
    .nullable()
    .optional()
    .describe("Target snapshot ID"),
  kind: FileOutsideLinkKindEnum.optional().describe("Link kind"),
  description: z.string().min(1).optional().describe("Link description"),
});

export const InputSchemaOutsideLinksDelete = WritePropertiesSchema.safeExtend({
  record_id: z.string().min(1).describe("Outside link record ID"),
});

export const InputSchemaLinksList = ProjectPropertiesSchema;

export const InputSchemaLinksAdd = ProjectPropertiesSchema.safeExtend({
  project_b_slug: z.string().min(1),
  branch_name: z.string().optional(),
  snapshot_id: z.string().optional(),
});

export const InputSchemaLinksRemove = InputSchemaLinksAdd;
