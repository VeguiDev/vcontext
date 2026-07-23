import fs from "node:fs";
import path from "node:path";
import {
  ProjectMarkerSchema,
  type ProjectMarker,
} from "@vcontext/versioning-contract";

export const PROJECT_MARKER_DIR = ".vcontext";
export const PROJECT_MARKER_FILE = "project.json";

export function writeProjectMarker(root: string, marker: ProjectMarker) {
  const parsed = ProjectMarkerSchema.parse(marker);
  const dir = path.join(root, PROJECT_MARKER_DIR);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, PROJECT_MARKER_FILE),
    JSON.stringify(parsed, null, 2) + "\n",
  );
}

export function findProjectMarker(start = process.cwd()) {
  let current = path.resolve(start);

  while (true) {
    const markerPath = path.join(
      current,
      PROJECT_MARKER_DIR,
      PROJECT_MARKER_FILE,
    );

    if (fs.existsSync(markerPath)) {
      const marker = ProjectMarkerSchema.parse(
        JSON.parse(fs.readFileSync(markerPath, "utf-8")),
      );

      return {
        root: current,
        path: markerPath,
        marker,
      };
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
