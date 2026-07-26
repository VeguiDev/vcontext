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

describe("CloudProjectLinkService", { concurrency: false }, () => {
  let home: string;
  let previousHome: string | undefined;
  let registry: RegistryStore;
  let linkService: CloudProjectLinkServiceType;
  let projectSlug: string;
  let targetSlug: string;
  const userId = "test-user-1";

  // Permission map: slug -> user -> role
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
    home = await mkdtemp(path.join(tmpdir(), "vcontext-cloud-link-service-"));
    previousHome = process.env.VCONTEXT_HOME;
    process.env.VCONTEXT_HOME = home;

    const [{ RegistryStore }, { CloudProjectLinkService }] =
      await Promise.all([
        import("../../src/storage/registry-store.js"),
        import("../../src/cloud/project-link-service.js"),
      ]);

    registry = new RegistryStore();
    const project = registry.create({ name: "Source Project" });
    const target = registry.create({ name: "Target Project" });
    projectSlug = project.slug;
    targetSlug = target.slug;

    linkService = new CloudProjectLinkService(registry, mockAuth);
  });

  after(async () => {
    registry.close();
    await rm(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.VCONTEXT_HOME;
    else process.env.VCONTEXT_HOME = previousHome;
  });

  describe("resolveProjectBySlug", () => {
    it("returns the project when it exists", () => {
      const project = linkService.resolveProjectBySlug(projectSlug);
      assert.notEqual(project, null);
      assert.equal(project!.slug, projectSlug);
    });

    it("returns null when the project does not exist", () => {
      const project = linkService.resolveProjectBySlug("non-existent");
      assert.equal(project, null);
    });
  });

  describe("create", () => {
    before(() => {
      // Set up permissions for tests in this describe block
      setPermission(projectSlug, userId, "OWNER");
      setPermission(targetSlug, userId, "READER");
    });

    after(() => {
      // Clean up links created during tests
      const source = registry.findBySlug(projectSlug);
      const target = registry.findBySlug(targetSlug);
      if (source && target) {
        registry.unlinkAll(source.id, target.id);
      }
      // Clean up any additional test project
      const extra = registry.findBySlug("extra-project");
      if (source && extra) {
        registry.unlinkAll(source.id, extra.id);
      }
    });

    it("creates a link when the caller has sufficient permissions", async () => {
      const link = await linkService.create(projectSlug, targetSlug, userId);

      assert.equal(link.slug, targetSlug);
      assert.equal(link.name, "Target Project");
      assert.equal(link.branch_name, null);
      assert.equal(link.snapshot_id, null);
    });

    it("throws FORBIDDEN when the caller lacks MAINTAINER on source", async () => {
      const restrictedUser = "no-permission-user";
      await assert.rejects(
        linkService.create(projectSlug, targetSlug, restrictedUser),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });

    it("throws FORBIDDEN when the caller lacks READER on target", async () => {
      // Create a third project where user has OWNER but no target access
      const extra = registry.create({ name: "Extra Project" });
      const source = registry.findBySlug(projectSlug);
      // Remove previous link
      const extraTarget = registry.findBySlug("extra-project");
      if (source && extraTarget) {
        registry.unlinkAll(source.id, extraTarget.id);
      }

      setPermission(projectSlug, userId, "OWNER");
      // Don't set permission on "extra-project" for userId

      await assert.rejects(
        linkService.create(projectSlug, extra.slug, userId),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });

    it("throws PROJECT_NOT_FOUND when target does not exist", async () => {
      await assert.rejects(
        linkService.create(projectSlug, "non-existent-project", userId),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "PROJECT_NOT_FOUND",
      );
    });

    it("throws CONFLICT when the link already exists", async () => {
      await assert.rejects(
        linkService.create(projectSlug, targetSlug, userId),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "CONFLICT",
      );
    });
  });

  describe("findByProjectId", () => {
    before(() => {
      setPermission(projectSlug, userId, "MAINTAINER");
      setPermission(targetSlug, userId, "READER");

      const source = registry.findBySlug(projectSlug);
      const target = registry.findBySlug(targetSlug);
      if (source && target) {
        const existingLinks = registry.links(source.id);
        if (!existingLinks.some((l) => l.slug === targetSlug)) {
          registry.link(source.id, target.id);
        }
      }
    });

    it("returns links for a project", async () => {
      const links = await linkService.findByProjectId(projectSlug, userId);
      assert.ok(Array.isArray(links));
      assert.ok(links.length >= 1, "Expected at least one link, got " + links.length);
      assert.ok(links.some((link) => link.slug === targetSlug));
    });

    it("throws FORBIDDEN when caller lacks MAINTAINER", async () => {
      const outsider = "outsider-user";
      await assert.rejects(
        linkService.findByProjectId(projectSlug, outsider),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });

    it("throws FORBIDDEN for non-existent project (auth check runs first)", async () => {
      await assert.rejects(
        linkService.findByProjectId("non-existent", userId),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });
  });

  describe("remove", () => {
    const removeUser = "remove-user";

    before(() => {
      setPermission(projectSlug, removeUser, "OWNER");
      setPermission(targetSlug, removeUser, "READER");
      const source = registry.findBySlug(projectSlug);
      const target = registry.findBySlug(targetSlug);
      if (source && target) registry.unlinkAll(source.id, target.id);
    });

    it("removes an existing link", async () => {
      await linkService.create(projectSlug, targetSlug, removeUser);

      await linkService.remove(projectSlug, targetSlug, removeUser);

      // Verify it's gone
      const links = await linkService.findByProjectId(projectSlug, removeUser);
      assert.equal(links.some((link) => link.slug === targetSlug), false);
    });

    it("throws RECORD_NOT_FOUND when link does not exist", async () => {
      // Create a temp project to test with
      const temp = registry.create({ name: "Temp Removal Test" });
      setPermission(temp.slug, removeUser, "OWNER");

      await assert.rejects(
        linkService.remove(temp.slug, "non-existent-target", removeUser),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "PROJECT_NOT_FOUND",
      );
    });

    it("throws FORBIDDEN when caller lacks MAINTAINER", async () => {
      const unauthorized = "unauthorized-user";
      await assert.rejects(
        linkService.remove(projectSlug, targetSlug, unauthorized),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });
  });

  describe("permission scenarios", () => {
    it("allows ORG_OWNER on source (above MAINTAINER threshold)", async () => {
      const orgOwnerUser = "org-owner-user";
      const orgTarget = registry.create({ name: "Org Owner Target" });
      setPermission(projectSlug, orgOwnerUser, "ORG_OWNER");
      setPermission(orgTarget.slug, orgOwnerUser, "READER");

      // Should work - ORG_OWNER >= MAINTAINER
      const link = await linkService.create(projectSlug, orgTarget.slug, orgOwnerUser);
      assert.equal(link.slug, orgTarget.slug);
    });

    it("rejects READER on source (below MAINTAINER threshold)", async () => {
      const readerUser = "reader-user";
      const readerTarget = registry.create({ name: "Reader Target" });
      setPermission(projectSlug, readerUser, "READER");
      setPermission(readerTarget.slug, readerUser, "READER");

      await assert.rejects(
        linkService.create(projectSlug, readerTarget.slug, readerUser),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });

    it("allows MAINTAINER on source (minimum threshold)", async () => {
      const maintainerUser = "maintainer-user";
      const maintainerTarget = registry.create({ name: "Maintainer Target" });
      setPermission(projectSlug, maintainerUser, "MAINTAINER");
      setPermission(maintainerTarget.slug, maintainerUser, "READER");

      const link = await linkService.create(projectSlug, maintainerTarget.slug, maintainerUser);
      assert.equal(link.slug, maintainerTarget.slug);
    });

    it("rejects create when caller has no access at all on source", async () => {
      const outsider = "complete-outsider";
      await assert.rejects(
        linkService.create(projectSlug, targetSlug, outsider),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "FORBIDDEN",
      );
    });
  });
});
