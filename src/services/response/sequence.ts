import type { ResponseActionPriority, ResponseActionType } from "@/types";

export interface ResponseActionDefinition {
  type: ResponseActionType;
  title: string;
  description: string;
  priority: ResponseActionPriority;
  guidance: string;
}

export const RESPONSE_ACTION_TYPES: readonly ResponseActionType[] = [
  "preserve_evidence",
  "contact_bank",
  "contact_1930",
  "report_cybercrime",
  "follow_up",
];

export const RESPONSE_ACTION_SEQUENCE: readonly ResponseActionDefinition[] = [
  {
    type: "preserve_evidence",
    title: "Preserve evidence",
    description:
      "Keep the exact messages, screenshots and transaction details safe before anything changes.",
    priority: "critical",
    guidance: "Recommended next step",
  },
  {
    type: "contact_bank",
    title: "Contact the bank or payment provider",
    description:
      "Ask about freezing or flagging the account through the bank or payment provider's official channel.",
    priority: "high",
    guidance: "Next",
  },
  {
    type: "contact_1930",
    title: "Contact 1930",
    description:
      "Report to the national cybercrime helpline and note any complaint reference you receive.",
    priority: "critical",
    guidance: "After bank contact",
  },
  {
    type: "report_cybercrime",
    title: "Report cybercrime",
    description:
      "File a report through the official online cybercrime reporting channel.",
    priority: "normal",
    guidance: "Next reporting step",
  },
  {
    type: "follow_up",
    title: "Follow up",
    description:
      "Keep monitoring the case and the account until the response is complete.",
    priority: "normal",
    guidance: "Continue monitoring your case",
  },
];

export function isResponseActionType(value: unknown): value is ResponseActionType {
  return (
    typeof value === "string" &&
    (RESPONSE_ACTION_TYPES as readonly string[]).includes(value)
  );
}

export function responseActionDefinition(
  type: ResponseActionType
): ResponseActionDefinition {
  const definition = RESPONSE_ACTION_SEQUENCE.find((entry) => entry.type === type);
  if (!definition) {
    throw new Error(`Unknown response action type: ${type}`);
  }
  return definition;
}