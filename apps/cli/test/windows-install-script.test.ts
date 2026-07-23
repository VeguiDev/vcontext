import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function repositoryFile(name: string): string {
  let directory = process.cwd();
  while (true) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml")))
      return candidate;
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate repository root");
    directory = parent;
  }
}

test("PowerShell installer stages and rolls back executable replacement", () => {
  const source = fs.readFileSync(repositoryFile("install.ps1"), "utf8");

  assert.match(source, /function Get-VContextExecutableVersion/);
  assert.match(source, /function Install-VContextExecutable/);
  assert.match(source, /Updating existing VContext/);
  assert.match(source, /Existing file at .* is not a recognized VContext/);
  assert.match(source, /Move-WithRetry \$Destination \$backup/);
  assert.match(source, /Move-WithRetry \$backup \$Destination/);
  assert.doesNotMatch(source, /vcontext already exists; use -Force/);
});

test(
  "PowerShell installer updates VContext by default and protects unrelated files",
  { skip: process.platform !== "win32" },
  () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vcontext-install-script-"),
    );
    temporaryDirectories.push(directory);
    const good = path.join(directory, "vcontext.cmd");
    const update = path.join(directory, "vcontext-update.cmd");
    const unrelated = path.join(directory, "unrelated.cmd");
    const destination = path.join(directory, "installed.cmd");
    fs.writeFileSync(
      good,
      [
        "@echo off",
        'if "%1"=="--version" (echo 0.1.1+7& exit /b 0)',
        'if "%1"=="--help" (echo vcontext - git for AI context& exit /b 0)',
        "exit /b 2",
      ].join("\r\n"),
    );
    fs.writeFileSync(
      update,
      [
        "@echo off",
        'if "%1"=="--version" (echo 0.1.1+8& exit /b 0)',
        'if "%1"=="--help" (echo vcontext - git for AI context& exit /b 0)',
        "exit /b 2",
      ].join("\r\n"),
    );
    fs.writeFileSync(
      unrelated,
      [
        "@echo off",
        'if "%1"=="--version" (echo 9.9.9& exit /b 0)',
        'if "%1"=="--help" (echo another tool& exit /b 0)',
        "exit /b 2",
      ].join("\r\n"),
    );

    const probe = [
      "$ErrorActionPreference = 'Stop'",
      "$source = Get-Content -LiteralPath $env:INSTALL_SCRIPT -Raw -Encoding UTF8",
      "$tokens = $null; $errors = $null",
      "$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)",
      "if ($errors.Count) { throw $errors[0] }",
      "$names = @('Fail', 'Get-VContextExecutableVersion', 'Move-WithRetry', 'Install-VContextExecutable')",
      "foreach ($name in $names) { $function = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true) | Select-Object -First 1; Invoke-Expression $function.Extent.Text }",
      "Copy-Item -LiteralPath $env:GOOD_EXECUTABLE -Destination $env:DESTINATION",
      "$installed = Install-VContextExecutable $env:UPDATE_EXECUTABLE $env:DESTINATION",
      "if ($installed -ne '0.1.1+8') { throw \"Expected updated VContext, received '$installed'\" }",
      "Copy-Item -LiteralPath $env:UNRELATED_EXECUTABLE -Destination $env:DESTINATION -Force",
      "$rejected = $false",
      "try { Install-VContextExecutable $env:UPDATE_EXECUTABLE $env:DESTINATION | Out-Null } catch { $rejected = $_.Exception.Message -match 'not a recognized VContext executable' }",
      "if (-not $rejected) { throw 'Expected unrelated executable collision to be rejected' }",
      "$unchanged = & $env:DESTINATION --help",
      "if ($unchanged -ne 'another tool') { throw 'Unrelated executable was modified without -Force' }",
      "$forced = Install-VContextExecutable $env:UPDATE_EXECUTABLE $env:DESTINATION -AllowUnsafeOverwrite",
      "if ($forced -ne '0.1.1+8') { throw \"Expected forced replacement, received '$forced'\" }",
    ].join("; ");

    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", probe],
      {
        env: {
          ...process.env,
          INSTALL_SCRIPT: repositoryFile("install.ps1"),
          GOOD_EXECUTABLE: good,
          UPDATE_EXECUTABLE: update,
          UNRELATED_EXECUTABLE: unrelated,
          DESTINATION: destination,
        },
        stdio: "pipe",
      },
    );
  },
);
