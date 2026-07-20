# Versioned-record migration plan

Migration `2.0.0` is the initial implementation of this plan because the
versioned storage work already existed when the migration framework was added.
It creates snapshots, ordered snapshot parents, branches, and immutable entity
revision tables; maps integer relationships to stable record IDs; preserves
timestamps; creates an initial snapshot and `main`; and caches
`current_branch` in project metadata.

Future changes to the versioned model must use a new migration version. Do not
edit an applied migration: checksum validation intentionally rejects that.
