import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { renderProjectContext } from "../../render/project-context.js";

export function registerProjectContextRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/context", (c) => {
    const project = services.Project(c.req.param("slug"));

    if (!project) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const accept = c.req.header("accept") ?? "";

    if (accept.includes("application/json")) {
      const pathContext = project.fileContext.find();

      return c.json({
        project: project.project,
        prompts: project.prompt.find(),
        documents: project.document.find(),
        changes: project.change.find(),
        tasks: project.task.find(),
        path_context: pathContext,
        file_context: pathContext,
      });
    }

    return c.text(renderProjectContext(project, { compact: c.req.query("compact") === "true" }));
  });
}
