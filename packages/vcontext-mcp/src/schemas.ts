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
  document_id: z.number().int().positive().nullable().optional(),
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
  document_id: z.number().int().positive().nullable().optional(),
  status: TaskStatusSchema.optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  document_id: z.number().int().positive().nullable().optional(),
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
  return z.coerce.number().int().positive().parse(value);
}

export const ProjectPropertiesSchema = z.object({
  slug: z.string().optional().describe("Project slug (optional if cwd resolves)"),
  cwd: z.string().optional().describe("Working directory for slug auto-resolution"),
});

export const InputSchemaContext = ProjectPropertiesSchema;

export const InputSchemaProjects = ProjectPropertiesSchema;

export const InputSchemaTasksList = ProjectPropertiesSchema;

export const InputSchemaTasksAdd = ProjectPropertiesSchema.extend({
  title: z.string().describe("Task title"),
  description: z.string().optional().describe("Task description"),
  status: TaskStatusSchema.optional().describe("Task status"),
});

export const InputSchemaTasksUpdate = ProjectPropertiesSchema.extend({
  taskId: z.number().describe("Task ID"),
  title: z.string().optional().describe("Task title"),
  description: z.string().optional().describe("Task description"),
  status: TaskStatusSchema.optional().describe("Task status"),
});

export const InputSchemaTasksDelete = ProjectPropertiesSchema.extend({
  taskId: z.number().describe("Task ID"),
});

export const InputSchemaDocumentsList = ProjectPropertiesSchema;

export const InputSchemaDocumentsGet = ProjectPropertiesSchema.extend({
  documentId: z.number().describe("Document ID"),
});

export const InputSchemaDocumentsAdd = ProjectPropertiesSchema.extend({
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content"),
});

export const InputSchemaDocumentsUpdate = ProjectPropertiesSchema.extend({
  documentId: z.number().describe("Document ID"),
  title: z.string().optional().describe("Document title"),
  content: z.string().optional().describe("Document content"),
});

export const InputSchemaDocumentsDelete = ProjectPropertiesSchema.extend({
  documentId: z.number().describe("Document ID"),
});

export const InputSchemaChangesList = ProjectPropertiesSchema;

export const InputSchemaChangesAdd = ProjectPropertiesSchema.extend({
  note: z.string().describe("Change note"),
  document_id: z.number().optional().describe("Related document ID"),
});

export const InputSchemaFileContextList = ProjectPropertiesSchema;

export const InputSchemaFileContextUpsert = ProjectPropertiesSchema.extend({
  path: z.string().describe("File or directory path"),
  description: z.string().describe("Context description"),
  kind: z
    .enum(["file", "directory", "path"])
    .optional()
    .describe("Context path kind"),
  filename: z.string().optional().describe("File name"),
  hash: z.string().optional().describe("Content hash"),
});

export const InputSchemaFileContextDelete = ProjectPropertiesSchema.extend({
  fileContextId: z.number().describe("File context entry ID"),
});

export const InputSchemaPromptsList = ProjectPropertiesSchema;

export const InputSchemaPromptsAdd = ProjectPropertiesSchema.extend({
  prompt: z.string().describe("Prompt text"),
});

export const InputSchemaPromptsUpdate = ProjectPropertiesSchema.extend({
  promptId: z.number().describe("Prompt ID"),
  prompt: z.string().describe("Prompt text"),
});

export const InputSchemaPromptsDelete = ProjectPropertiesSchema.extend({
  promptId: z.number().describe("Prompt ID"),
});
