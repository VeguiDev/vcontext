import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AuthorizationRequestSchema,
  DiscoveryDocumentSchema,
  FetchResponseSchema,
  MissingRequestSchema,
  PushRequestSchema,
  SYNC_LIMITS,
  SyncErrorResponseSchema,
  SyncObjectSchema,
  VERSIONING_CONTRACT_VERSION,
  canonicalizeJson,
  hashSyncObject,
  isWithinSyncByteLimit,
  sha256,
  verifySyncObject,
  withSyncObjectHash,
  ProjectMarkerSchema,
  LegacyProjectMarkerSchema,
  FetchV2RequestSchema,
  PushV2RequestSchema,
  SnapshotMetadataSchema,
  SYNC_V2_LIMITS,
} from "../dist/src/index.js";

const projectId = "project-1";
const snapshotInput = {
  object_type: "snapshot",
  id: "snapshot-1",
  payload: {
    id: "snapshot-1",
    message: "Initial snapshot",
    created_at: 1_700_000_000_000,
    parents: [],
  },
};

test("package exposes the frozen contract version and limits", () => {
  assert.equal(VERSIONING_CONTRACT_VERSION, "0.1.0");
  assert.deepEqual(SYNC_LIMITS.fetch, { max_objects: 500, max_bytes: 8_388_608 });
  assert.deepEqual(SYNC_LIMITS.missing, { max_descriptors: 10_000, max_bytes: 2_097_152 });
  assert.equal(SYNC_LIMITS.continuation_ttl_seconds, 900);
  assert.equal(SYNC_LIMITS.access_token_ttl_seconds, 3600);
  assert.equal(SYNC_LIMITS.refresh_token_ttl_seconds, 2_592_000);
});

test("canonical JSON sorts keys recursively and keeps array order", () => {
  assert.equal(
    canonicalizeJson({ z: 1, a: { y: 2, x: [3, { b: true, a: null }] } }),
    '{"a":{"x":[3,{"a":null,"b":true}],"y":2},"z":1}',
  );
  assert.equal(canonicalizeJson({ value: -0 }), '{"value":0}');
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("canonical JSON rejects non-portable values", () => {
  assert.throws(() => canonicalizeJson({ bad: undefined }), /undefined/);
  assert.throws(() => canonicalizeJson({ bad: Number.NaN }), /finite/);
  assert.throws(() => canonicalizeJson(1n), /bigint/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic), /cyclic/);
  const sparse = [];
  sparse[1] = "x";
  assert.throws(() => canonicalizeJson(sparse), /sparse/);
});

test("hash is SHA-256 of canonical object_type, id and payload only", () => {
  const expected = createHash("sha256")
    .update(canonicalizeJson(snapshotInput))
    .digest("hex");
  assert.equal(hashSyncObject(snapshotInput), expected);

  const first = withSyncObjectHash(projectId, snapshotInput);
  const second = { ...first, project_id: "different-project" };
  assert.equal(hashSyncObject(first), hashSyncObject(second));
  assert.equal(hashSyncObject(first), first.hash);
  assert.equal(hashSyncObject({ ...first, hash: "0".repeat(64) }), first.hash);
  assert.equal(verifySyncObject(first), true);
  assert.equal(verifySyncObject({ ...first, hash: "0".repeat(64) }), false);
});

test("all sync object variants parse and outer ids match payload ids", () => {
  const snapshot = withSyncObjectHash(projectId, snapshotInput);
  const identity = withSyncObjectHash(projectId, {
    object_type: "record_identity",
    id: "record-1",
    payload: { id: "record-1", entity_type: "document", created_at: 10 },
  });
  const revision = withSyncObjectHash(projectId, {
    object_type: "record_revision",
    id: "revision-1",
    payload: {
      id: "revision-1",
      record_id: "record-1",
      snapshot_id: "snapshot-1",
      previous_revision_id: null,
      entity_type: "document",
      deleted_at: null,
      created_at: 10,
      updated_at: 11,
      data: { title: "Read me", nested: { rank: 1 } },
    },
  });

  for (const object of [snapshot, identity, revision]) {
    assert.deepEqual(SyncObjectSchema.parse(object), object);
    assert.equal(verifySyncObject(object), true);
  }
  assert.equal(
    SyncObjectSchema.safeParse({ ...snapshot, id: "not-the-payload-id" }).success,
    false,
  );
});

test("record identity created_at participates in its hash", () => {
  const base = {
    object_type: "record_identity",
    id: "record-1",
    payload: { id: "record-1", entity_type: "task", created_at: 10 },
  };
  assert.notEqual(
    hashSyncObject(base),
    hashSyncObject({ ...base, payload: { ...base.payload, created_at: 11 } }),
  );
});

test("wire schemas enforce envelopes, CAS fields and project membership", () => {
  const object = withSyncObjectHash(projectId, snapshotInput);
  const push = PushRequestSchema.parse({
    protocol_version: 1,
    project_id: projectId,
    request_id: "request-1",
    client_id: "client-1",
    objects: [object],
    ref_updates: [{ name: "main", old_snapshot_id: null, new_snapshot_id: "snapshot-1" }],
  });
  assert.equal(push.ref_updates[0].force, false);
  assert.equal(
    PushRequestSchema.safeParse({ ...push, project_id: "another-project" }).success,
    false,
  );
  assert.equal(
    FetchResponseSchema.safeParse({
      protocol_version: 1,
      project_id: projectId,
      objects: [object],
      refs: [{ name: "main", snapshot_id: "snapshot-1" }],
      continuation: null,
    }).success,
    true,
  );
  assert.equal(
    MissingRequestSchema.safeParse({ protocol_version: 2, project_id: projectId, objects: [] })
      .success,
    false,
  );
});

test("count and byte limits are exposed and enforceable", () => {
  const descriptor = { object_type: "snapshot", id: "s", hash: "0".repeat(64) };
  assert.equal(
    MissingRequestSchema.safeParse({
      protocol_version: 1,
      project_id: projectId,
      objects: Array.from({ length: SYNC_LIMITS.missing.max_descriptors + 1 }, () => descriptor),
    }).success,
    false,
  );
  assert.equal(isWithinSyncByteLimit("missing", { small: true }), true);
  assert.equal(
    isWithinSyncByteLimit("missing", { value: "x".repeat(SYNC_LIMITS.missing.max_bytes) }),
    false,
  );
});

test("discovery has absolute endpoints and authorization enforces PKCE S256", () => {
  const discovery = {
    service: "vcontext",
    authorization_endpoint: "https://cloud.example/auth",
    token_endpoint: "https://cloud.example/token",
    revocation_endpoint: "https://cloud.example/revoke",
    api_endpoint: "https://api.example/api/v1",
    supported_sync_versions: [1],
  };
  assert.equal(DiscoveryDocumentSchema.safeParse(discovery).success, true);
  assert.equal(
    DiscoveryDocumentSchema.safeParse({ ...discovery, authorization_endpoint: "/auth" }).success,
    false,
  );
  const auth = {
    response_type: "code",
    client_id: "cli",
    redirect_uri: "http://127.0.0.1:8080/callback",
    state: "state",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
  };
  assert.equal(AuthorizationRequestSchema.safeParse(auth).success, true);
  assert.equal(
    AuthorizationRequestSchema.safeParse({ ...auth, code_challenge_method: "plain" }).success,
    false,
  );
});

test("wire errors accept only stable codes", () => {
  assert.equal(
    SyncErrorResponseSchema.safeParse({
      error: { code: "NON_FAST_FORWARD", message: "remote advanced" },
    }).success,
    true,
  );
  assert.equal(
    SyncErrorResponseSchema.safeParse({ error: { code: "MADE_UP", message: "no" } }).success,
    false,
  );
});

test("strict marker v1 and read-only legacy marker are disjoint", () => {
  const id = "d94dfe65-9f55-4cd6-ada4-4f28bc7fb213";
  assert.equal(ProjectMarkerSchema.safeParse({ version: 1, project_id: id, project: "acme/docs", remote: `https://cloud.example/api/v1/projects/${id}` }).success, true);
  assert.equal(ProjectMarkerSchema.safeParse({ version: 1, project_id: id, project: "acme/docs", remote: `https://cloud.example/api/v1/projects/other`, slug: "extra" }).success, false);
  assert.equal(LegacyProjectMarkerSchema.safeParse({ slug: "docs", uuid: id }).success, true);
});

test("sync v2 carries metadata separately and keeps v1 objects unchanged", () => {
  const metadata = SnapshotMetadataSchema.parse({ snapshot_id: "snapshot-1", author: { cloud_id: "user-1", name: "Ada", email: "ada@example.com" }, git_commit_sha: null, git_branch: "main", git_dirty: false, commit_message: "Initial", version: 1 });
  assert.equal(FetchV2RequestSchema.safeParse({ protocol_version: 2, project_id: projectId, have: [], have_snapshot_metadata: [{ snapshot_id: metadata.snapshot_id, version: 1 }] }).success, true);
  assert.equal(PushV2RequestSchema.safeParse({ protocol_version: 2, project_id: projectId, request_id: "request-2", client_id: "client-1", objects: [], snapshot_metadata: [metadata], ref_updates: [] }).success, true);
  assert.equal(PushV2RequestSchema.safeParse({ protocol_version: 1, project_id: projectId, request_id: "request-2", client_id: "client-1", objects: [], snapshot_metadata: [metadata], ref_updates: [] }).success, false);
  assert.equal(SYNC_V2_LIMITS.fetch.max_snapshot_metadata, 500);
});
