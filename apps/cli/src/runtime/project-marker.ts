import fs from "node:fs";
import path from "node:path";

export const PROJECT_MARKER_DIR = ".vcontext";
export const PROJECT_MARKER_FILE = "project.json";

export interface ProjectMarker {
  slug: string;
  uuid: string;
}

export function writeProjectMarker(root: string, marker: ProjectMarker) {
  const dir = path.join(root, PROJECT_MARKER_DIR);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, PROJECT_MARKER_FILE),
    JSON.stringify(marker, null, 2) + "\n",
  );
}

export function findProjectMarker(start = process.cwd()) {
  let current = path.resolve(start);

  while (true) {
    const markerPath = path.join(current, PROJECT_MARKER_DIR, PROJECT_MARKER_FILE);

    if (fs.existsSync(markerPath)) {
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as ProjectMarker;

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
