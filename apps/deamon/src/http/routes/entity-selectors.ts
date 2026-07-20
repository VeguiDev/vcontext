import type { Context } from "hono";
import { ApplicationError } from "../../application/errors.js";

export function readSelector(c: Context) {
  const branch = c.req.query("branch");
  const snapshot_id = c.req.query("snapshot") ?? c.req.query("snapshot_id");
  if (branch && snapshot_id) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "branch and snapshot_id are mutually exclusive",
    );
  }
  return { branch, snapshot_id };
}

export function writeSelector(c: Context) {
  if (c.req.query("snapshot") || c.req.query("snapshot_id")) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Writes cannot target a snapshot; select a branch",
    );
  }
  return {
    branch: c.req.query("branch"),
    message: c.req.query("message"),
  };
}

export function locator(c: Context) {
  return { project_slug: c.req.param("slug") };
}
