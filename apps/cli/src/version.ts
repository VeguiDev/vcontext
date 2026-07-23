declare const VCONTEXT_VERSION_BUILD: string | undefined;

export const VCONTEXT_VERSION =
  typeof VCONTEXT_VERSION_BUILD === "string" ? VCONTEXT_VERSION_BUILD : "0.1.1";
