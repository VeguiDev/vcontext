import type { RegistryStore, LinkedProject, RegisteredProject } from "../storage/registry-store.js";
import { ApplicationError } from "../application/errors.js";

/**
 * Roles a user can have on a project in the cloud context.
 */
export type CloudProjectRole = "OWNER" | "MAINTAINER" | "READER" | "ORG_OWNER";

/**
 * A user's effective permissions on a project.
 */
export interface ProjectPermission {
  role: CloudProjectRole;
  userId: string;
}

/**
 * Interface for resolving a user's permissions on a project.
 * Tests provide a mock; production wiring connects to the cloud auth service.
 */
export interface CloudAuthorizationService {
  /**
   * Resolve the caller's permission on the project identified by slug.
   * Returns null when the user has no access / the project does not exist.
   */
  getProjectPermission(slug: string, userId: string): Promise<ProjectPermission | null>;
}

/**
 * Service for managing cloud project links with authorization.
 *
 * Links represent a directed relationship from a source project to a target
 * project.  Creating a link requires MAINTAINER (or above) on the source and
 * READER (or above) on the target.  Listing and removing require MAINTAINER
 * on the source project.
 */
export class CloudProjectLinkService {
  constructor(
    private readonly registry: RegistryStore,
    private readonly auth: CloudAuthorizationService,
  ) {}

  /**
   * Resolve a project slug to its registered project record.
   * Returns null when the project does not exist.
   */
  resolveProjectBySlug(slug: string): RegisteredProject | null {
    return this.registry.findBySlug(slug);
  }

  /**
   * Create a link from `slug` to `targetSlug`.
   *
   * Throws when:
   *  - the caller lacks MAINTAINER on the source project
   *  - the caller lacks READER on the target project
   *  - the target project does not exist
   *  - the link already exists
   */
  async create(
    slug: string,
    targetSlug: string,
    userId: string,
  ): Promise<LinkedProject> {
    const sourcePerm = await this.auth.getProjectPermission(slug, userId);
    if (!sourcePerm || !isAtLeast(sourcePerm.role, "MAINTAINER")) {
      throw new ApplicationError(
        "FORBIDDEN",
        `User ${userId} does not have MAINTAINER access on project "${slug}"`,
        { requiredRole: "MAINTAINER", projectSlug: slug, userId },
      );
    }

    const target = this.registry.findBySlug(targetSlug);
    if (!target) {
      throw new ApplicationError(
        "PROJECT_NOT_FOUND",
        `Target project "${targetSlug}" not found`,
      );
    }

    const targetPerm = await this.auth.getProjectPermission(targetSlug, userId);
    if (!targetPerm || !isAtLeast(targetPerm.role, "READER")) {
      throw new ApplicationError(
        "FORBIDDEN",
        `User ${userId} does not have READER access on target project "${targetSlug}"`,
        { requiredRole: "READER", projectSlug: targetSlug, userId },
      );
    }

    const source = this.registry.findBySlug(slug);
    if (!source) {
      throw new ApplicationError("PROJECT_NOT_FOUND", `Source project "${slug}" not found`);
    }

    const created = this.registry.link(source.id, target.id);
    if (!created) {
      throw new ApplicationError(
        "CONFLICT",
        `Link from "${slug}" to "${targetSlug}" already exists`,
      );
    }

    return this.registry.links(source.id).find(
      (link) => link.slug === targetSlug,
    )!;
  }

  /**
   * List all links for a project.  Requires MAINTAINER on the source project.
   */
  async findByProjectId(slug: string, userId: string): Promise<LinkedProject[]> {
    const sourcePerm = await this.auth.getProjectPermission(slug, userId);
    if (!sourcePerm || !isAtLeast(sourcePerm.role, "MAINTAINER")) {
      throw new ApplicationError(
        "FORBIDDEN",
        `User ${userId} does not have MAINTAINER access on project "${slug}"`,
        { requiredRole: "MAINTAINER", projectSlug: slug, userId },
      );
    }

    const project = this.registry.findBySlug(slug);
    if (!project) {
      throw new ApplicationError("PROJECT_NOT_FOUND", `Project "${slug}" not found`);
    }

    return this.registry.links(project.id);
  }

  /**
   * Remove a link from `slug` to `targetSlug`.
   * Requires MAINTAINER on the source project.
   */
  async remove(slug: string, targetSlug: string, userId: string): Promise<void> {
    const sourcePerm = await this.auth.getProjectPermission(slug, userId);
    if (!sourcePerm || !isAtLeast(sourcePerm.role, "MAINTAINER")) {
      throw new ApplicationError(
        "FORBIDDEN",
        `User ${userId} does not have MAINTAINER access on project "${slug}"`,
        { requiredRole: "MAINTAINER", projectSlug: slug, userId },
      );
    }

    const source = this.registry.findBySlug(slug);
    if (!source) {
      throw new ApplicationError("PROJECT_NOT_FOUND", `Project "${slug}" not found`);
    }

    const target = this.registry.findBySlug(targetSlug);
    if (!target) {
      throw new ApplicationError("PROJECT_NOT_FOUND", `Target project "${targetSlug}" not found`);
    }

    const removed = this.registry.unlinkAll(source.id, target.id);
    if (!removed) {
      throw new ApplicationError(
        "RECORD_NOT_FOUND",
        `Link from "${slug}" to "${targetSlug}" not found`,
      );
    }
  }
}

const ROLE_HIERARCHY: CloudProjectRole[] = ["READER", "MAINTAINER", "OWNER", "ORG_OWNER"];

function isAtLeast(role: CloudProjectRole, required: CloudProjectRole): boolean {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(required);
}
