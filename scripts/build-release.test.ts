import { describe, expect, test } from "bun:test";
import {
  compileTargetFor,
  releaseTargets,
  type ReleaseTarget,
} from "./build-release";

const nativePlatforms: Array<[ReleaseTarget, string, string]> = [
  ["linux-x64", "linux", "x64"],
  ["linux-arm64", "linux", "arm64"],
  ["darwin-x64", "darwin", "x64"],
  ["darwin-arm64", "darwin", "arm64"],
  ["windows-x64", "win32", "x64"],
];

describe("release compile targets", () => {
  test.each(nativePlatforms)(
    "uses the installed Bun runtime for %s",
    (name, platform, arch) => {
      expect(compileTargetFor(name, platform, arch)).toBeUndefined();
    },
  );

  test("keeps the explicit Bun target for cross-compilation", () => {
    expect(compileTargetFor("windows-x64", "linux", "x64")).toBe(
      releaseTargets["windows-x64"].target,
    );
  });
});
