import { codexModelFamily } from "@t3tools/shared/model";

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

export function reasoningEffortLabel(reasoningEffort: string): string {
  return REASONING_EFFORT_LABELS[reasoningEffort] ?? reasoningEffort;
}

export function codexDefaultReasoningEffort(
  model: string,
  advertisedDefault: string | null | undefined,
) {
  return codexModelFamily(model) === "gpt-6-astra" ? "medium" : advertisedDefault;
}
