import { describe, expect, test } from "bun:test";
import { resolveReleaseVersion } from "./resolve-release-version";

describe("resolveReleaseVersion", () => {
  test("combines package version and build number", () => {
    expect(resolveReleaseVersion("1.2.3", "42")).toEqual({ baseVersion: "1.2.3", buildNumber: "42", version: "1.2.3+42", tag: "v1.2.3+42", prerelease: false });
  });
  test("preserves prerelease identifiers", () => {
    expect(resolveReleaseVersion("1.2.3-beta.1", "7")).toMatchObject({ version: "1.2.3-beta.1+7", prerelease: true });
  });
  test("rejects package build metadata", () => {
    expect(() => resolveReleaseVersion("1.2.3+old", "7")).toThrow("without build metadata");
  });
  test("rejects non-numeric build numbers", () => {
    expect(() => resolveReleaseVersion("1.2.3", "abc")).toThrow("non-negative integer");
  });
});