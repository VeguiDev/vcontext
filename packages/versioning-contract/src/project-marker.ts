import { z } from "zod";

const ProjectPathSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/);

export const ProjectMarkerSchema = z
  .object({
    version: z.literal(1),
    project_id: z.uuid(),
    project: ProjectPathSchema,
    remote: z.url().refine((value) => {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.pathname.endsWith(`/api/v1/projects/${url.pathname.split("/").at(-1)}`)
      );
    }, "remote must be an absolute VContext project API URL"),
  })
  .strict()
  .refine((value) => value.remote.endsWith(`/api/v1/projects/${value.project_id}`), {
    message: "remote project id must match project_id",
    path: ["remote"],
  });

/** Read-only compatibility shape. It must only be rewritten by an explicit command. */
export const LegacyProjectMarkerSchema = z
  .object({ slug: z.string().min(1).max(255), uuid: z.uuid() })
  .strict();

export const AnyProjectMarkerSchema = z.union([
  ProjectMarkerSchema,
  LegacyProjectMarkerSchema,
]);

export type ProjectMarker = z.infer<typeof ProjectMarkerSchema>;
export type LegacyProjectMarker = z.infer<typeof LegacyProjectMarkerSchema>;
export type AnyProjectMarker = z.infer<typeof AnyProjectMarkerSchema>;
