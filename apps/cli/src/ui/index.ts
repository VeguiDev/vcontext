import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import pc from "picocolors";
import ora, { type Ora } from "ora";

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
  hint?: string;
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

export function configureUi(options: Partial<CliOptions> = {}): CliUi {
  current = new CliUi({ ...defaults, ...options });
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

  constructor(options: CliOptions) {
    this.options = options;
    this.isTTY = Boolean(stdin.isTTY && stdout.isTTY) && !options.json;
    this.color = !options.noColor && Boolean(stdout.isTTY) && !options.json;
  }

  line(message = ""): void {
    stdout.write(`${message}\n`);
  }

  errorLine(message = ""): void {
    stderr.write(`${message}\n`);
  }

  intro(title: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(this.brand(title));
  }

  success(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(`${this.green("✓")} ${message}`);
  }

  info(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(`${this.blue("●")} ${message}`);
  }

  warn(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(`${this.yellow("⚠")} ${message}`);
  }

  step(message: string): void {
    if (this.options.quiet || this.options.json) return;
    this.line(`${this.cyan("→")} ${message}`);
  }

  note(message: string): void {
    if (this.options.quiet || this.options.json) return;
    for (const line of message.split("\n"))
      this.line(`${this.dim("│")} ${line}`);
  }

  json(value: unknown): void {
    if (this.options.quiet) return;
    this.line(JSON.stringify(value, null, 2));
  }

  command(value: string): string {
    return this.cyan(value);
  }

  path(value: string): string {
    return this.underline(value);
  }

  url(value: string): string {
    return this.underline(value);
  }

  branch(value: string): string {
    return this.magenta(value);
  }

  id(value: string): string {
    return this.dim(value);
  }

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    if (!this.isTTY || this.options.json || this.options.quiet) return false;
    const reader = createInterface({ input: stdin, output: stdout });
    try {
      const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
      while (true) {
        const answer = (await reader.question(`${question}${suffix}`))
          .trim()
          .toLowerCase();
        if (!answer) return defaultValue;
        if (["y", "yes"].includes(answer)) return true;
        if (["n", "no"].includes(answer)) return false;
        this.warn("Please answer yes or no.");
      }
    } finally {
      reader.close();
    }
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
    this.errorLine(`${this.red("✖")} ${data.message}`);
    if (data.hint) this.errorLine(`${this.cyan("→")} ${data.hint}`);
    if (this.options.verbose && data.debug?.stack)
      this.errorLine(data.debug.stack);
  }

  brand(value: string): string {
    return this.color ? pc.bold(pc.cyan(value)) : value;
  }
  green(value: string): string {
    return this.color ? pc.green(value) : value;
  }
  blue(value: string): string {
    return this.color ? pc.blue(value) : value;
  }
  yellow(value: string): string {
    return this.color ? pc.yellow(value) : value;
  }
  red(value: string): string {
    return this.color ? pc.red(value) : value;
  }
  cyan(value: string): string {
    return this.color ? pc.cyan(value) : value;
  }
  magenta(value: string): string {
    return this.color ? pc.magenta(value) : value;
  }
  dim(value: string): string {
    return this.color ? pc.dim(value) : value;
  }
  underline(value: string): string {
    return this.color ? pc.underline(value) : value;
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
      this.instance = ora({ text: this.message, stream: stdout }).start();
    else this.ui.step(this.message);
  }

  update(message: string): void {
    if (this.instance) this.instance.text = message;
  }

  succeed(message = this.message): void {
    if (this.instance) this.instance.succeed(message);
    else if (!this.ui.options.quiet && !this.ui.options.json && !this.ui.isTTY)
      this.ui.success(message);
  }

  warn(message = this.message): void {
    if (this.instance) this.instance.warn(message);
    else if (!this.ui.options.quiet && !this.ui.options.json && !this.ui.isTTY)
      this.ui.warn(message);
  }

  fail(message = this.message): void {
    if (this.instance) this.instance.fail(message);
    else if (!this.ui.options.quiet && !this.ui.options.json && !this.ui.isTTY)
      this.ui.errorLine(`${this.ui.red("✖")} ${message}`);
  }
}

current = new CliUi(defaults);
