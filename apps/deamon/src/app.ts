import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { RegistryStore } from "./storage/registry-store.js";
import { ProjectStore } from "./storage/project-store.js";

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  local_path: z.string().optional(),
});

const LinkProjectSchema = z.object({
  project_b_id: z.number().int().positive(),
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
  Project: (id: number) => ProjectStore | null;
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

  app.get("/projects", (c) => {
    return c.json(services.registry.all());
  });

  app.post("/projects", async (c) => {
    const body = CreateProjectSchema.parse(await c.req.json());
    const project = services.registry.create(body);

    return c.json(project, 201);
  });

  app.get("/projects/:id", (c) => {
    const project = services.registry.findById(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project);
  });

  app.get("/projects/:id/links", (c) => {
    const projectId = parseId(c.req.param("id"));
    const project = services.registry.findById(projectId);

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(services.registry.links(projectId));
  });

  app.post("/projects/:id/links", async (c) => {
    const projectId = parseId(c.req.param("id"));
    const body = LinkProjectSchema.parse(await c.req.json());
    const project = services.registry.findById(projectId);
    const linkedProject = services.registry.findById(body.project_b_id);

    if (!project || !linkedProject) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      linked: services.registry.link(projectId, body.project_b_id),
    });
  });

  app.get("/projects/:id/context", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

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

  app.get("/projects/:id/prompts", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.prompt.find());
  });

  app.post("/projects/:id/prompts", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = ProjectPromptSchema.parse(await c.req.json());

    return c.json(project.prompt.create(body), 201);
  });

  app.patch("/projects/:id/prompts/:promptId", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

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

  app.delete("/projects/:id/prompts/:promptId", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.prompt.delete(parseId(c.req.param("promptId"))),
    });
  });

  app.get("/projects/:id/documents", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.document.find());
  });

  app.post("/projects/:id/documents", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateDocumentSchema.parse(await c.req.json());

    return c.json(project.document.create(body), 201);
  });

  app.patch("/projects/:id/documents/:documentId", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

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

  app.delete("/projects/:id/documents/:documentId", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.document.delete(parseId(c.req.param("documentId"))),
    });
  });

  app.get("/projects/:id/changes", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.change.find());
  });

  app.post("/projects/:id/changes", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateChangeSchema.parse(await c.req.json());

    return c.json(project.change.create(body), 201);
  });

  app.get("/projects/:id/tasks", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const status = c.req.query("status");

    if (status) {
      return c.json(project.task.find(TaskStatusSchema.parse(status)));
    }

    return c.json(project.task.find());
  });

  app.post("/projects/:id/tasks", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = CreateTaskSchema.parse(await c.req.json());

    return c.json(project.task.create(body), 201);
  });

  app.patch("/projects/:id/tasks/:taskId", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

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

  app.delete("/projects/:id/tasks/:taskId", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json({
      deleted: project.task.delete(parseId(c.req.param("taskId"))),
    });
  });

  app.get("/projects/:id/file-context", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    return c.json(project.fileContext.find());
  });

  app.post("/projects/:id/file-context", async (c) => {
    const project = services.Project(parseId(c.req.param("id")));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const body = UpsertFileContextSchema.parse(await c.req.json());

    return c.json(project.fileContext.upsert(body), 201);
  });

  app.delete("/projects/:id/file-context/:fileContextId", (c) => {
    const project = services.Project(parseId(c.req.param("id")));

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
