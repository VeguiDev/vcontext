import type { Hono } from "hono";
import type { AppServices } from "../../app.js";
import { locator, readSelector } from "./entity-selectors.js";

export function registerProjectContextRoutes(app: Hono, services: AppServices) {
  app.get("/projects/:slug/context", async (c) => {
    const selector = readSelector(c);
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("application/json")) {
      return c.json(await services.application!.context(locator(c), selector));
    }
    return c.text(
      await services.application!.renderContext(
        locator(c),
        selector,
        c.req.query("compact") === "true",
      ),
    );
  });
}
