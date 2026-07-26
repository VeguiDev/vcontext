import type { Database } from "./database.js";
import type {
  ChangeRecord,
  DocumentRecord,
  EntityType,
  FileContextRecord,
  FileOutsideLinkRecord,
  ProjectPromptRecord,
  TaskRecord,
  VersionedRecord,
} from "./project-records.js";

export type EntityRecordMap = {
  project_prompt: ProjectPromptRecord;
  document: DocumentRecord;
  change_note: ChangeRecord;
  task: TaskRecord;
  file_context: FileContextRecord;
  file_outside_link: FileOutsideLinkRecord;
};

export const ENTITY_TYPES: EntityType[] = [
  "project_prompt",
  "document",
  "change_note",
  "task",
  "file_context",
  "file_outside_link",
];

export const ENTITY_FIELDS: Record<EntityType, string[]> = {
  project_prompt: ["prompt"],
  document: ["title", "content"],
  change_note: ["note", "document_id"],
  task: ["title", "description", "document_id", "status"],
  file_context: ["kind", "filename", "path", "hash", "description"],
  file_outside_link: [
    "source_file_context_id",
    "target_project_slug",
    "target_path",
    "target_type",
    "target_branch_name",
    "target_snapshot_id",
    "kind",
    "description",
  ],
};

const ANCESTRY_CTE = `
  WITH RECURSIVE ancestry(snapshot_id, depth, parent_path) AS (
    SELECT ?, 0, ''
    UNION ALL
    SELECT parent.parent_snapshot_id,
           ancestry.depth + 1,
           ancestry.parent_path || printf('/%08d', parent.parent_order)
    FROM ancestry
    JOIN snapshot_parent parent ON parent.snapshot_id = ancestry.snapshot_id
  )
`;

export class SnapshotStateResolver {
  constructor(private readonly db: Database) {}

  resolve<T extends EntityType>(
    snapshotId: string,
    entityType: T,
    includeDeleted = false,
  ): Array<EntityRecordMap[T]> {
    const deletedFilter = includeDeleted
      ? ""
      : "WHERE ranked.deleted_at IS NULL";
    return this.db
      .prepare(
        `
        ${ANCESTRY_CTE},
        ranked AS (
          SELECT entity.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY entity.record_id
                   ORDER BY ancestry.depth ASC, ancestry.parent_path ASC, entity.id ASC
                 ) AS state_rank
          FROM ${entityType} entity
          JOIN ancestry ON ancestry.snapshot_id = entity.snapshot_id
        )
        SELECT ${columns(entityType, "ranked")}
        FROM ranked
        ${deletedFilter}
          ${deletedFilter ? "AND" : "WHERE"} ranked.state_rank = 1
      `,
      )
      .all(snapshotId) as Array<EntityRecordMap[T]>;
  }

  findByRecordId<T extends EntityType>(
    snapshotId: string,
    entityType: T,
    recordId: string,
    includeDeleted = false,
  ): EntityRecordMap[T] | null {
    const record = this.db
      .prepare(
        `
        ${ANCESTRY_CTE}
        SELECT ${columns(entityType, "entity")}
        FROM ${entityType} entity
        JOIN ancestry ON ancestry.snapshot_id = entity.snapshot_id
        WHERE entity.record_id = ?
        ORDER BY ancestry.depth ASC, ancestry.parent_path ASC, entity.id ASC
        LIMIT 1
      `,
      )
      .get(snapshotId, recordId) as EntityRecordMap[T] | undefined;

    if (!record || (!includeDeleted && record.deleted_at !== null)) return null;
    return record;
  }

  findRevisionById<T extends EntityType>(
    entityType: T,
    revisionId: string,
  ): EntityRecordMap[T] | null {
    return (
      (this.db
        .prepare(
          `SELECT ${columns(entityType)} FROM ${entityType} WHERE id = ?`,
        )
        .get(revisionId) as EntityRecordMap[T] | undefined) ?? null
    );
  }

  history<T extends EntityType>(
    snapshotId: string,
    entityType: T,
    recordId: string,
  ): Array<EntityRecordMap[T]> {
    return this.db
      .prepare(
        `
        ${ANCESTRY_CTE},
        visible_history AS (
          SELECT entity.*,
                 ancestry.depth,
                 ancestry.parent_path,
                 ROW_NUMBER() OVER (
                   PARTITION BY entity.id
                   ORDER BY ancestry.depth ASC, ancestry.parent_path ASC
                 ) AS path_rank
          FROM ${entityType} entity
          JOIN ancestry ON ancestry.snapshot_id = entity.snapshot_id
          WHERE entity.record_id = ?
        )
        SELECT ${columns(entityType, "visible_history")}
        FROM visible_history
        WHERE path_rank = 1
        ORDER BY updated_at DESC, id DESC
      `,
      )
      .all(snapshotId, recordId) as Array<EntityRecordMap[T]>;
  }

  resolveAll(snapshotId: string, includeDeleted = false) {
    const state = new Map<EntityType, Map<string, VersionedRecord>>();
    for (const entityType of ENTITY_TYPES) {
      state.set(
        entityType,
        new Map(
          this.resolve(snapshotId, entityType, includeDeleted).map((record) => [
            record.record_id,
            record,
          ]),
        ),
      );
    }
    return state;
  }

  commonAncestor(leftSnapshotId: string, rightSnapshotId: string) {
    const result = this.db
      .prepare(
        `
        WITH RECURSIVE
        left_ancestors(snapshot_id, depth, parent_path) AS (
          SELECT ?, 0, ''
          UNION ALL
          SELECT parent.parent_snapshot_id,
                 left_ancestors.depth + 1,
                 left_ancestors.parent_path || printf('/%08d', parent.parent_order)
          FROM left_ancestors
          JOIN snapshot_parent parent ON parent.snapshot_id = left_ancestors.snapshot_id
        ),
        right_ancestors(snapshot_id, depth, parent_path) AS (
          SELECT ?, 0, ''
          UNION ALL
          SELECT parent.parent_snapshot_id,
                 right_ancestors.depth + 1,
                 right_ancestors.parent_path || printf('/%08d', parent.parent_order)
          FROM right_ancestors
          JOIN snapshot_parent parent ON parent.snapshot_id = right_ancestors.snapshot_id
        ),
        left_best AS (
          SELECT snapshot_id, MIN(depth) AS depth, MIN(parent_path) AS parent_path
          FROM left_ancestors GROUP BY snapshot_id
        ),
        right_best AS (
          SELECT snapshot_id, MIN(depth) AS depth, MIN(parent_path) AS parent_path
          FROM right_ancestors GROUP BY snapshot_id
        )
        SELECT left_best.snapshot_id AS id
        FROM left_best
        JOIN right_best USING (snapshot_id)
        ORDER BY left_best.depth + right_best.depth ASC,
                 right_best.depth ASC,
                 right_best.parent_path ASC,
                 left_best.parent_path ASC,
                 left_best.snapshot_id ASC
        LIMIT 1
      `,
      )
      .get(leftSnapshotId, rightSnapshotId) as { id: string } | undefined;

    return result?.id ?? null;
  }
}

function columns(entityType: EntityType, alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  return [
    "id",
    "record_id",
    "snapshot_id",
    "previous_revision_id",
    "deleted_at",
    ...ENTITY_FIELDS[entityType],
    "created_at",
    "updated_at",
  ]
    .map((column) => `${prefix}${column}`)
    .join(", ");
}
