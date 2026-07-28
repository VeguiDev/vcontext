import { stdin, stdout, stderr } from "node:process";
import { Writable, type Readable } from "node:stream";
import boxen from "boxen";
import pc from "picocolors";
import ora, { type Ora } from "ora";
import { DaemonClientError } from "@repo/daemon-client";
import {
  ClackPromptAdapter,
  PROMPT_CANCELLED,
  type CliPromptAdapter,
} from "./prompts.js";

export interface UiWriter {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): unknown;
}

export interface UiReader {
  isTTY?: boolean;
}

export interface UiSelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface CliUiEnvironment {
  input?: UiReader;
  output?: UiWriter;
  error?: UiWriter;
  isTTY?: boolean;
  color?: boolean;
  columns?: number;
  commandName?: string;
  prompts?: CliPromptAdapter;
}

export interface CliOptions {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
}

export interface CliErrorData {
  code: string;
  message: string;
  status?: number;
  hint?: string;
  notes?: string[];
  details?: Record<string, unknown>;
  debug?: { stack?: string; command?: string };
}

const defaults: CliOptions = {
  json: false,
  quiet: false,
  verbose: process.env.VCONTEXT_DEBUG === "1",
  noColor: Boolean(process.env.NO_COLOR),
  yes: false,
  help: false,
  version: false,
};

let current: CliUi;

export function configureUi(
  options: Partial<CliOptions> = {},
  environment: CliUiEnvironment = {},
): CliUi {
  current = new CliUi({ ...defaults, ...options }, environment);
  return current;
}

export function getUi(): CliUi {
  return current;
}

export function parseGlobalOptions(input: string[]): CliOptions {
  const options: CliOptions = { ...defaults };
  const flags: Array<[keyof CliOptions, string]> = [
    ["json", "--json"],
    ["quiet", "--quiet"],
    ["verbose", "--verbose"],
    ["noColor", "--no-color"],
    ["yes", "--yes"],
    ["help", "--help"],
    ["help", "-h"],
    ["version", "--version"],
  ];
  for (const [key, flag] of flags) {
    while (input.includes(flag)) {
      input.splice(input.indexOf(flag), 1);
      options[key] = true;
    }
  }
  return options;
}

export class CliUi {
  readonly options: CliOptions;
  readonly isTTY: boolean;
  readonly color: boolean;
  readonly columns: number;
  readonly commandName: string;
  private readonly input: UiReader;
  private readonly output: UiWriter;
  private readonly errorOutput: UiWriter;
  private readonly prompts: CliPromptAdapter;

  constructor(options: CliOptions, environment: CliUiEnvironment = {}) {
    this.options = options;
    this.input = environment.input ?? stdin;
    this.output = environment.output ?? stdout;
    this.errorOutput = environment.error ?? stderr;
    this.isTTY =
      (environment.isTTY ?? Boolean(this.input.isTTY && this.output.isTTY)) &&
      !options.json;
    this.color =
      !options.noColor &&
      !options.json &&
      (environment.color ?? Boolean(this.output.isTTY));
    this.commandName =
      environment.commandName ??
      process.env.VCONTEXT_CLI_NAME?.trim() ??
      "vcontext";
    this.columns = Math.max(
      40,
      environment.columns ?? this.output.columns ?? 80,
    );
    this.prompts =
      environment.prompts ??
      new ClackPromptAdapter(
        this.input as Readable,
        this.color
          ? (this.output as unknown as Writable)
          : new SgrStrippingWriter(this.output, this.columns),
      );
  }

  get rich(): boolean {
    return this.isTTY && !this.options.json;
  }

  line(message = ""): void {
    this.output.write(`${message}\n`);
  }

  errorLine(message = ""): void {
    this.errorOutput.write(`${message}\n`);
  }

  intro(title: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(this.brand(title));
  }

  success(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(this.rich ? `${this.green("✓")} ${message}` : message);
  }

  info(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(this.rich ? `${this.brand("●")} ${message}` : message);
  }

  warn(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(
      this.rich ? `${this.yellow("⚠")} ${message}` : `Warning: ${message}`,
    );
  }

  step(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(this.rich ? `${this.brand("→")} ${message}` : message);
  }

  note(message: string): void {
    if (this.options.quiet || this.options.json) return;
    for (const line of message.split("\n"))
      this.line(this.rich ? `${this.brand("│")} ${line}` : line);
  }

  json(value: unknown): void {
    if (this.options.quiet) return;
    this.line(JSON.stringify(value, null, 2));
  }

  command(value: string): string {
    return this.brand(value);
  }

  path(value: string): string {
    return this.underline(value);
  }

  url(value: string): string {
    return this.underline(value);
  }

  branch(value: string): string {
    return this.brand(value);
  }

  id(value: string): string {
    return this.dim(value);
  }

  qualify(message: string, detail: string): string {
    return this.rich ? `${message} · ${detail}` : `${message} (${detail})`;
  }

  cli(command: string): string {
    return `${this.commandName} ${command}`;
  }

  async textInput(
    message: string,
    options?: { placeholder?: string; defaultValue?: string },
  ): Promise<string> {
    if (!this.isTTY || this.options.json || this.options.quiet) {
      return options?.defaultValue ?? "";
    }
    const result = await this.prompts.text({
      message,
      placeholder: options?.placeholder,
      defaultValue: options?.defaultValue,
    });
    return this.promptResult(result);
  }

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    if (!this.isTTY || this.options.json || this.options.quiet) return false;
    const result = await this.prompts.confirm({
      message: question,
      initialValue: defaultValue,
    });
    return this.promptResult(result);
  }

  async select<T extends string>(
    question: string,
    options: readonly UiSelectOption<T>[],
  ): Promise<T> {
    if (!this.isTTY || this.options.json || this.options.quiet)
      throw new Error("Interactive selection requires a terminal");
    const result = await this.prompts.select<T>({
      message: question,
      options,
    });
    return this.promptResult(result);
  }

  spinner(message: string): UiSpinner {
    return new UiSpinner(this, message);
  }

  async run<T>(message: string, operation: () => Promise<T>): Promise<T> {
    const spinner = this.spinner(message);
    spinner.start();
    try {
      const value = await operation();
      spinner.succeed(message);
      return value;
    } catch (error) {
      spinner.fail(message);
      throw error;
    }
  }

  error(data: CliErrorData): void {
    if (this.options.json) {
      const value = this.options.verbose
        ? data
        : {
            code: data.code,
            message: data.message,
            ...(data.hint ? { hint: data.hint } : {}),
          };
      this.errorLine(JSON.stringify({ error: value }));
      return;
    }
    const metadata = [
      data.code !== "CLI_ERROR" ? data.code : undefined,
      data.status ? `HTTP ${data.status}` : undefined,
    ].filter((value): value is string => Boolean(value));
    if (this.rich) {
      const secondary = [
        ...(metadata.length ? [this.dim(metadata.join(" · "))] : []),
        ...(data.notes ?? []),
      ];
      const content = [
        data.message,
        ...(secondary.length ? ["", ...secondary] : []),
      ].join("\n");
      this.errorLine(
        boxen(content, {
          borderStyle: "round",
          padding: { top: 1, right: 2, bottom: 1, left: 2 },
          title: this.red("× Error"),
          titleAlignment: "left",
          width: Math.min(this.columns, 88),
          ...(this.color ? { borderColor: "#ff6b6b" } : {}),
        }),
      );
      if (data.hint) {
        this.errorLine();
        this.errorLine(
          `${this.brand("❯")} ${this.formatInlineCode(data.hint)}`,
        );
      }
    } else {
      this.errorLine(`Error: ${data.message}`);
      if (metadata.length) this.errorLine(`Code: ${metadata.join(" / ")}`);
      for (const note of data.notes ?? []) this.errorLine(`Note: ${note}`);
      if (data.hint) this.errorLine(`Hint: ${data.hint}`);
    }
    if (this.options.verbose && data.debug?.stack) {
      this.errorLine();
      this.errorLine(data.debug.stack);
    }
  }

  updateAvailable(currentVersion: string, latestVersion: string): void {
    if (!this.rich) return;
    const content = `${this.dim(currentVersion)} ${this.brand("→")} ${this.brand(latestVersion)}`;
    this.errorLine();
    this.errorLine(
      boxen(content, {
        borderStyle: "round",
        padding: { top: 0, right: 2, bottom: 0, left: 2 },
        title: this.brand("Update available"),
        titleAlignment: "left",
        width: Math.min(this.columns, 48),
        ...(this.color ? { borderColor: "#54a0ff" } : {}),
      }),
    );
    this.errorLine();
    this.errorLine(
      `${this.brand("❯")} Run ${this.command(this.cli("update"))}`,
    );
  }

  updateResult(
    result:
      | {
          success: true;
          previousVersion: string;
          currentVersion: string;
        }
      | {
          success: false;
          currentVersion: string;
          error?: string;
        },
  ): void {
    if (!this.rich) return;
    this.errorLine(
      result.success
        ? `${this.green("✓")} Updated vcontext ${result.previousVersion} ${this.brand("→")} ${result.currentVersion}`
        : `${this.red("×")} Could not finish updating to ${result.currentVersion}${result.error ? `: ${result.error}` : "."}`,
    );
  }

  brand(value: string): string {
    return this.paint(value, [84, 160, 255], true);
  }
  green(value: string): string {
    return this.paint(value, [29, 209, 161]);
  }
  blue(value: string): string {
    return this.paint(value, [84, 160, 255]);
  }
  yellow(value: string): string {
    return this.paint(value, [254, 202, 87]);
  }
  red(value: string): string {
    return this.paint(value, [255, 107, 107]);
  }
  cyan(value: string): string {
    return this.paint(value, [72, 219, 251]);
  }
  magenta(value: string): string {
    return this.paint(value, [95, 39, 205]);
  }
  dim(value: string): string {
    return this.color ? pc.dim(value) : value;
  }
  underline(value: string): string {
    return this.color ? pc.underline(value) : value;
  }

  spinnerStream(): typeof stdout {
    return this.output as typeof stdout;
  }

  private paint(
    value: string,
    [red, green, blue]: [number, number, number],
    bold = false,
  ): string {
    if (!this.color) return value;
    const content = bold ? pc.bold(value) : value;
    return `\u001B[38;2;${red};${green};${blue}m${content}\u001B[39m`;
  }

  private formatInlineCode(value: string): string {
    if (!this.color) return value;
    return value.replace(/`([^`]+)`/g, (_match, command: string) =>
      this.command(command),
    );
  }

  private promptResult<T>(result: T | typeof PROMPT_CANCELLED): T {
    if (result === PROMPT_CANCELLED)
      throw new DaemonClientError("Operation cancelled.", 130, undefined, {
        code: "OPERATION_CANCELLED",
      });
    return result as T;
  }
}

export class UiSpinner {
  private instance: Ora | null = null;
  constructor(
    private readonly ui: CliUi,
    private readonly message: string,
  ) {}

  start(): void {
    if (this.ui.options.quiet || this.ui.options.json) return;
    if (this.ui.isTTY)
      this.instance = ora({
        text: this.message,
        stream: this.ui.spinnerStream(),
      }).start();
  }

  update(message: string): void {
    if (this.instance) this.instance.text = message;
  }

  succeed(message = this.message): void {
    if (this.instance)
      this.instance.stopAndPersist({
        symbol: this.ui.green("✓"),
        text: message,
      });
  }

  warn(message = this.message): void {
    if (this.instance) this.instance.warn(message);
  }

  fail(message = this.message): void {
    if (this.instance) this.instance.fail(message);
  }
}

class SgrStrippingWriter extends Writable {
  readonly isTTY: boolean;
  readonly columns: number;

  constructor(
    private readonly target: UiWriter,
    columns: number,
  ) {
    super();
    this.isTTY = Boolean(target.isTTY);
    this.columns = columns;
  }

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      this.target.write(chunk.toString().replace(/\u001B\[[0-9;]*m/g, ""));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

current = new CliUi(defaults);
