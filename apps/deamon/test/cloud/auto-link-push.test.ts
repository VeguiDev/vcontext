import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type {
  CloudAuthorizationService,
  CloudProjectRole,
  CloudProjectLinkService as CloudProjectLinkServiceType,
} from "../../src/cloud/project-link-service.js";
import type { RegistryStore } from "../../src/storage/registry-store.js";
import type { ProjectService } from "../../src/project/project-service.js";
import { AutoLinkPushHook } from "../../src/sync/auto-link-push.js";

describe("AutoLinkPushHook", { concurrency: false }, () => {
  let home: string;
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let projectService: ProjectService;
  let linkService: CloudProjectLinkServiceType;
  let autoLink: AutoLinkPushHook;
  let sourceSlug: string;
  let targetSlug: string;
  let inaccessibleSlug: string;
  const userId = "auto-link-user";

  const permissions = new Map<string, Map<string, CloudProjectRole>>();

  function setPermission(slug: string, user: string, role: CloudProjectRole) {
    if (!permissions.has(slug)) permissions.set(slug, new Map());
    permissions.get(slug)!.set(user, role);
  }

  const mockAuth: CloudAuthorizationService = {
    async getProjectPermission(slug: string, user: string) {
      const slugPerms = permissions.get(slug);
      const role = slugPerms?.get(user);
      if (!role) return null;
      return { role, userId: user };
    },
  };

  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "vcontext-auto-link-push-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;

    const [
      { RegistryStore },
      { ProjectService },
      { CloudProjectLinkService },
    ] = await Promise.all([
      import("../../src/storage/registry-store.js"),
      import("../../src/project/project-service.js"),
      import("../../src/cloud/project-link-service.js"),
    ]);

    registry = new RegistryStore();
    projectService = new ProjectService(registry);

    // Create source project
    const sourceProject = registry.create({ name: "Auto Link Source" });
    sourceSlug = sourceProject.slug;
    registry.addPath(sourceSlug, {
      type: "local",
      path: path.join(home, "source"),
      label: "workspace",
    });

    // Create accessible target project
    const targetProject = registry.create({ name: "Auto Link Target" });
    targetSlug = targetProject.slug;
    registry.addPath(targetSlug, {
      type: "local",
      path: path.join(home, "target"),
      label: "workspace",
    });

    // Create inaccessible (no permission) target project
    const inaccessibleProject = registry.create({ name: "Inaccessible Target" });
    inaccessibleSlug = inaccessibleProject.slug;
    registry.addPath(inaccessibleSlug, {
      type: "local",
      path: path.join(home, "inaccessible"),
      label: "workspace",
    });

    // Grant permissions
    setPermission(sourceSlug, userId, "OWNER");
    setPermission(targetSlug, userId, "READER");
    // No permission on inaccessibleSlug for userId

    linkService = new CloudProjectLinkService(registry, mockAuth);
    autoLink = new AutoLinkPushHook(linkService, projectService);
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  /**
   * Helper: create a file_outside_link record in the source project.
   */
  async function createOutsideLink(
    targetSlug: string,
  ): Promise<void> {
    const handle = await projectService.open(sourceSlug);
    try {
      if (!handle.store) throw new Error("Store not opened");
      handle.store.createEntity(
        handle.store.current_branch,
        "file_outside_link",
        {
          target_project_slug: targetSlug,
          target_type: "project",
          kind: "dependency",
          description: `Auto-link test to ${targetSlug}`,
        },
      );
    } finally {
      handle.close();
    }
  }

  describe("afterPush", () => {
    it("creates links for accessible referenced projects", async () => {
      await createOutsideLink(targetSlug);

      const result = await autoLink.afterPush(sourceSlug, userId);

      assert.equal(result.created, 1);
      assert.equal(result.skipped, 0);
      assert.equal(result.unresolved, 0);
      assert.equal(result.details.length, 1);
      assert.equal(result.details[0]?.targetSlug, targetSlug);
      assert.equal(result.details[0]?.status, "created");

      // Verify the link exists via the service
      const links = await linkService.findByProjectId(sourceSlug, userId);
      assert.ok(links.some((l) => l.slug === targetSlug));
    });

    it("skips already-linked projects", async () => {
      // The link from the previous test already exists
      const result = await autoLink.afterPush(sourceSlug, userId);

      assert.equal(result.created, 0);
      assert.equal(result.skipped, 1);
      assert.equal(result.unresolved, 0);
      assert.equal(result.details[0]?.status, "skipped");
    });

    it("skips references to inaccessible projects (no link, push succeeds)", async () => {
      await createOutsideLink(inaccessibleSlug);

      const result = await autoLink.afterPush(sourceSlug, userId);

      // The accessible target is already linked (skipped), inaccessible is unresolved
      // So we should see: skipped for targetSlug, error/unresolved for inaccessibleSlug
      assert.equal(result.created, 0);
      assert.equal(result.unresolved, 1);

      const inaccessibleDetail = result.details.find(
        (d) => d.targetSlug === inaccessibleSlug,
      );
      assert.ok(inaccessibleDetail);
      assert.equal(inaccessibleDetail?.status, "error");

      // Verify no link was created for inaccessible target
      const links = await linkService.findByProjectId(sourceSlug, userId);
      assert.equal(links.some((l) => l.slug === inaccessibleSlug), false);
    });

    it("has no side effects when there are no outside links", async () => {
      // Create a fresh project with no outside links
      const cleanProject = registry.create({ name: "Clean Project" });
      registry.addPath(cleanProject.slug, {
        type: "local",
        path: path.join(home, "clean"),
        label: "workspace",
      });
      setPermission(cleanProject.slug, userId, "OWNER");

      const result = await autoLink.afterPush(cleanProject.slug, userId);

      assert.equal(result.created, 0);
      assert.equal(result.skipped, 0);
      assert.equal(result.unresolved, 0);
      assert.deepEqual(result.details, []);
    });

    it("handles multiple references to the same project (creates one link)", async () => {
      // Create a new source project
      const multiSource = registry.create({ name: "Multi Link Source" });
      registry.addPath(multiSource.slug, {
        type: "local",
        path: path.join(home, "multi-source"),
        label: "workspace",
      });
      setPermission(multiSource.slug, userId, "OWNER");

      // Create two outside links both pointing to the same target
      const multiHandle = await projectService.open(multiSource.slug);
      try {
        if (!multiHandle.store) throw new Error("Store not opened");
        multiHandle.store.createEntity(
          multiHandle.store.current_branch,
          "file_outside_link",
          {
            target_project_slug: targetSlug,
            target_type: "project",
            kind: "dependency",
            description: "First reference",
          },
        );
        multiHandle.store.createEntity(
          multiHandle.store.current_branch,
          "file_outside_link",
          {
            target_project_slug: targetSlug,
            target_type: "project",
            kind: "import",
            description: "Second reference",
          },
        );
      } finally {
        multiHandle.close();
      }

      const result = await autoLink.afterPush(multiSource.slug, userId);

      // Should create 1 link (deduplicated by slug)
      assert.equal(result.created, 1);
      assert.equal(result.details.length, 1);
    });

    it("handles self-references gracefully (no link created)", async () => {
      await createOutsideLink(sourceSlug);

      const result = await autoLink.afterPush(sourceSlug, userId);

      // Self-reference should be skipped silently
      const selfRefDetail = result.details.find(
        (d) => d.targetSlug === sourceSlug,
      );
      // The self-reference should not appear in the result details
      // (it's filtered out before calling create)
      assert.equal(selfRefDetail, undefined);
    });
  });
});
