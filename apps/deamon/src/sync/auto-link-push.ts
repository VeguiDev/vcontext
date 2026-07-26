import type { CloudProjectLinkService } from "../cloud/project-link-service.js";
import type { ProjectService } from "../project/project-service.js";

/**
 * Results from running auto-link for a single push.
 */
export interface AutoLinkPushResult {
  /** Number of links that were newly created. */
  created: number;
  /** Number of links that already existed (skipped). */
  skipped: number;
  /** Number of target projects that could not be resolved (skipped). */
  unresolved: number;
  /** Details per target project. */
  details: Array<{
    targetSlug: string;
    status: "created" | "skipped" | "unresolved" | "error";
    error?: string;
  }>;
}

/**
 * Hook that, after a push, scans the pushed project's file_outside_link
 * records and auto-creates cloud project links for any unique target
 * project slugs found.
 *
 * This is called AFTER a successful push to establish links between the
 * source project and the projects it references via file_outside_link.
 */
export class AutoLinkPushHook {
  constructor(
    private readonly linkService: CloudProjectLinkService,
    private readonly projectService: ProjectService,
  ) {}

  /**
   * Run auto-link for the project identified by `slug`.
   *
   * @param slug - The project that was just pushed.
   * @param userId - The identity used for the push (used for permission checks).
   */
  async afterPush(slug: string, userId: string): Promise<AutoLinkPushResult> {
    const targetSlugs = await this.collectTargetSlugs(slug);
    const result: AutoLinkPushResult = { created: 0, skipped: 0, unresolved: 0, details: [] };

    for (const targetSlug of [...new Set(targetSlugs)]) {
      if (targetSlug === slug) {
        // Skip self-references
        continue;
      }

      // Check if the target project exists in the registry
      const targetProject = this.linkService.resolveProjectBySlug(targetSlug);
      if (!targetProject) {
        result.unresolved += 1;
        result.details.push({ targetSlug, status: "unresolved" });
        continue;
      }

      try {
        await this.linkService.create(slug, targetSlug, userId);
        result.created += 1;
        result.details.push({ targetSlug, status: "created" });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          result.skipped += 1;
          result.details.push({ targetSlug, status: "skipped" });
        } else {
          // Permission errors or other failures
          result.unresolved += 1;
          result.details.push({
            targetSlug,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return result;
  }

  /**
   * Read the pushed project's file_outside_link records to collect
   * unique target project slugs.
   */
  private async collectTargetSlugs(slug: string): Promise<string[]> {
    try {
      const handle = await this.projectService.open(slug);
      try {
        if (!handle.store) return [];

        // Read file_outside_link records from the current branch head
        const branch = handle.store.requireBranch(handle.store.current_branch);
        if (!branch.snapshot_id) return [];

        const records = handle.store.branch().fileOutsideLink?.find() ?? [];
        return records
          .map((r: { target_project_slug?: string }) => r.target_project_slug)
          .filter((s: string | undefined): s is string => Boolean(s));
      } finally {
        handle.close();
      }
    } catch {
      // If the project can't be opened (e.g. doesn't exist), return empty
      return [];
    }
  }
}
