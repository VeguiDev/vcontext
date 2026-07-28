import type { Readable, Writable } from "node:stream";
import {
  confirm as clackConfirm,
  isCancel,
  select as clackSelect,
  text as clackText,
  type Option,
} from "@clack/prompts";

export const PROMPT_CANCELLED = Symbol("vcontext.prompt.cancelled");
export type PromptCancelled = typeof PROMPT_CANCELLED;

export interface PromptSelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface CliPromptAdapter {
  confirm(options: {
    message: string;
    initialValue: boolean;
  }): Promise<boolean | PromptCancelled>;
  select<T extends string>(options: {
    message: string;
    options: readonly PromptSelectOption<T>[];
  }): Promise<T | PromptCancelled>;
  text(options: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
  }): Promise<string | PromptCancelled>;
}

export class ClackPromptAdapter implements CliPromptAdapter {
  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  async confirm(options: {
    message: string;
    initialValue: boolean;
  }): Promise<boolean | PromptCancelled> {
    const result = await clackConfirm({
      ...options,
      input: this.input,
      output: this.output,
    });
    return isCancel(result) ? PROMPT_CANCELLED : result;
  }

  async select<T extends string>(options: {
    message: string;
    options: readonly PromptSelectOption<T>[];
  }): Promise<T | PromptCancelled> {
    const result = await clackSelect<T>({
      message: options.message,
      options: [...options.options] as Option<T>[],
      input: this.input,
      output: this.output,
    });
    return isCancel(result) ? PROMPT_CANCELLED : result;
  }

  async text(options: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
  }): Promise<string | PromptCancelled> {
    const result = await clackText({
      message: options.message,
      placeholder: options.placeholder,
      defaultValue: options.defaultValue,
      input: this.input,
      output: this.output,
    });
    return isCancel(result) ? PROMPT_CANCELLED : result;
  }
}
