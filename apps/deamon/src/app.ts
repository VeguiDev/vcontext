import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { RegistryStore } from "./storage/registry-store.js";
import { ProjectStore } from "./storage/project-store.js";

const CreateProjectSchema = z.object({
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

const LinkProjectSchema = z.object({
  project_b_slug: z.string().min(1),
});

const ProjectPathSchema = z.object({
  type: z.enum(["local", "remote"]),
  path: z.string().min(1),
  label: z.string().nullable().optional(),
});

const ProjectPromptSchema = z.object({
  prompt: z.string().min(1),
});

const CreateDocumentSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
});

const UpdateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
});

const CreateChangeSchema = z.object({
  note: z.string().min(1),
  document_id: z.number().int().positive().nullable().optional(),
});

const TaskStatusSchema = z.enum([
  "BACKLOG",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
]);

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  document_id: z.number().int().positive().nullable().optional(),
  status: TaskStatusSchema.optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  document_id: z.number().int().positive().nullable().optional(),
  status: TaskStatusSchema.optional(),
});

const UpsertFileContextSchema = z.object({
  filename: z.string().min(1),
  path: z.string().min(1),
  hash: z.string().min(1),
  description: z.string(),
});

export interface AppServices {
  registry: RegistryStore;
  Project: (slug: string) => ProjectStore | null;
  pid?: number;
  shutdown?: () => void;
}

export function createApp(services: AppServices) {
  const app = new Hono();

  app.use(logger());
  app.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json({ error: "invalid_request", issues: error.issues }, 400);
    }

    console.error(error);

    return c.json({ error: "internal_error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/daemon/status", (c) => {
    return c.json({
      ok: true,
      pid: services.pid ?? process.pid,
    });
  });

  app.post("/daemon/stop", (c) => {
    if (!services.shutdown) {
      return c.json({ error: "shutdown_unavailable" }, 503);
    }

    services.shutdown();

    return c.json({ stopping: true });
  });

  app.get("/projects", (c) => {
    return c.json(services.registry.all());
  });

  app.post("/projects", async (c) => {
    const body = CreateProjectSchema.parse(await c.req.json());
    const project = services.registry.create(body);

    for (const projectPath of body.paths ?? []) {
      services.registry.addPath(project.slug, projectPath);
    }

    return c.json(project, 201);
  });

  app.get("/projects/by-path", (c) => {
    const type = z.enum(["local", "remote"]).parse(c.req.query("type"));
    const value = z.string().min(1).parse(c.req.query("path"));
    const project = services.registry.findByPath(type, value);

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project);
  });

  app.get("/projects/:slug", (c) => {
    const project = services.registry.findBySlug(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project);
  });

  app.get("/projects/:slug/paths", (c) => {
    const paths = services.registry.paths(c.req.param("slug"));

    if (!paths) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(paths);
  });

  app.post("/projects/:slug/paths", async (c) => {
    const body = ProjectPathSchema.parse(await c.req.json());
    const projectPath = services.registry.addPath(c.req.param("slug"), body);

    if (!projectPath) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(projectPath, 201);
  });

  app.get("/projects/:slug/links", (c) => {
    const links = services.registry.linksBySlug(c.req.param("slug"));

    if (!links) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(links);
  });

  app.post("/projects/:slug/links", async (c) => {
    const slug = c.req.param("slug");
    const body = LinkProjectSchema.parse(await c.req.json());
    const project = services.registry.findBySlug(slug);
    const linkedProject = services.registry.findBySlug(body.project_b_slug);

    if (!project || !linkedProject) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      linked: services.registry.link(project.id, linkedProject.id),
    });
  });

  app.get("/projects/:slug/context", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const accept = c.req.header("accept") ?? "";

    if (accept.includes("application/json")) {
      return c.json({
        project: project.project,
        prompts: project.prompt.find(),
        documents: project.document.find(),
        changes: project.change.find(),
        tasks: project.task.find(),
        file_context: project.fileContext.find(),
      });
    }

    return c.text(project.renderContext());
  });

  app.get("/projects/:slug/prompts", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.prompt.find());
  });

  app.post("/projects/:slug/prompts", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = ProjectPromptSchema.parse(await c.req.json());

    return c.json(project.prompt.create(body), 201);
  });

  app.patch("/projects/:slug/prompts/:promptId", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = ProjectPromptSchema.parse(await c.req.json());
    const prompt = project.prompt.update(parseId(c.req.param("promptId")), body);

    if (!prompt) {
      return c.json({ error: "prompt_not_found" }, 404);
    }

    return c.json(prompt);
  });

  app.delete("/projects/:slug/prompts/:promptId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.prompt.delete(parseId(c.req.param("promptId"))),
    });
  });

  app.get("/projects/:slug/documents", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.document.find());
  });

  app.post("/projects/:slug/documents", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateDocumentSchema.parse(await c.req.json());

    return c.json(project.document.create(body), 201);
  });

  app.patch("/projects/:slug/documents/:documentId", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpdateDocumentSchema.parse(await c.req.json());
    const document = project.document.update(
      parseId(c.req.param("documentId")),
      body,
    );

    if (!document) {
      return c.json({ error: "document_not_found" }, 404);
    }

    return c.json(document);
  });

  app.delete("/projects/:slug/documents/:documentId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.document.delete(parseId(c.req.param("documentId"))),
    });
  });

  app.get("/projects/:slug/changes", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.change.find());
  });

  app.post("/projects/:slug/changes", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateChangeSchema.parse(await c.req.json());

    return c.json(project.change.create(body), 201);
  });

  app.get("/projects/:slug/tasks", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const status = c.req.query("status");

    if (status) {
      return c.json(project.task.find(TaskStatusSchema.parse(status)));
    }

    return c.json(project.task.find());
  });

  app.post("/projects/:slug/tasks", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateTaskSchema.parse(await c.req.json());

    return c.json(project.task.create(body), 201);
  });

  app.patch("/projects/:slug/tasks/:taskId", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpdateTaskSchema.parse(await c.req.json());
    const task = project.task.update(parseId(c.req.param("taskId")), body);

    if (!task) {
      return c.json({ error: "task_not_found" }, 404);
    }

    return c.json(task);
  });

  app.delete("/projects/:slug/tasks/:taskId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.task.delete(parseId(c.req.param("taskId"))),
    });
  });

  app.get("/projects/:slug/file-context", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.fileContext.find());
  });

  app.post("/projects/:slug/file-context", async (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpsertFileContextSchema.parse(await c.req.json());

    return c.json(project.fileContext.upsert(body), 201);
  });

  app.delete("/projects/:slug/file-context/:fileContextId", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.fileContext.delete(parseId(c.req.param("fileContextId"))),
    });
  });

  return app;
}

function parseId(value: string) {
  return z.coerce.number().int().positive().parse(value);
}
