import * as semver from "semver";

export function normalizeReleaseVersion(value: string): string | null {
  const normalized = value.trim().replace(/^v/, "");
  return semver.parse(normalized)?.raw ?? null;
}

export function compareReleaseVersions(left: string, right: string): number {
  const normalizedLeft = normalizeReleaseVersion(left);
  const normalizedRight = normalizeReleaseVersion(right);
  if (!normalizedLeft || !normalizedRight) {
    throw new TypeError(
      `Invalid release version: ${!normalizedLeft ? left : right}`,
    );
  }
  return semver.compareBuild(normalizedLeft, normalizedRight);
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareReleaseVersions(latest, current) > 0;
}

export function isStableReleaseVersion(value: string): boolean {
  const normalized = normalizeReleaseVersion(value);
  return normalized !== null && semver.prerelease(normalized) === null;
}
