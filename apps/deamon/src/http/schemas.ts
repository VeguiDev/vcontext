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
  filename: z.string().min(1),
  path: z.string().min(1),
  hash: z.string().min(1),
  description: z.string(),
});

export function parseId(value: string) {
  return z.coerce.number().int().positive().parse(value);
}
