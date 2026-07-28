declare var VCONTEXT_VERSION_BUILD: string | undefined;
declare var VCONTEXT_DISTRIBUTION_BUILD: string | undefined;

export const VCONTEXT_VERSION: string =
  (typeof VCONTEXT_VERSION_BUILD !== "undefined" && VCONTEXT_VERSION_BUILD) ||
  "0.1.1";

export const VCONTEXT_DISTRIBUTION: "npm" | "standalone" | "source" =
  (typeof VCONTEXT_DISTRIBUTION_BUILD === "string" && VCONTEXT_DISTRIBUTION_BUILD === "npm") ? "npm" :
  (typeof VCONTEXT_DISTRIBUTION_BUILD === "string" && VCONTEXT_DISTRIBUTION_BUILD === "standalone") ? "standalone" :
  "source";
