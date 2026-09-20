import {
  DetectDocumentTextCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

export type TextractImageBlock = {
  blockType: string;
  text?: string;
  confidence?: number;
};

export interface TextractImageResult {
  text: string;
  confidence?: number;
}

export function isAwsConfigured(): boolean {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const hasRegion = Boolean(region);
  const hasStaticCredentials =
    Boolean(process.env.AWS_ACCESS_KEY_ID) &&
    Boolean(process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);
  return hasRegion && (hasStaticCredentials || hasProfile);
}

let textractClient: TextractClient | null = null;

function getClient(): TextractClient {
  if (!textractClient) {
    textractClient = new TextractClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return textractClient;
}

export function normalizeBlocks(blocks: TextractImageBlock[]): TextractImageResult {
  const lines = blocks
    .filter((block) => block.blockType === "LINE" && block.text)
    .map((block) => block.text as string);
  const confidenceValues = blocks
    .filter(
      (block) =>
        block.blockType === "WORD" && typeof block.confidence === "number"
    )
    .map((block) => block.confidence as number);
  const confidence =
    confidenceValues.length > 0
      ? Math.round(
          confidenceValues.reduce((sum, value) => sum + value, 0) /
            confidenceValues.length
        )
      : undefined;
  return {
    text: lines.join("\n"),
    confidence,
  };
}

export interface ExtractImageTextInput {
  bytes: Uint8Array;
}

export async function extractImageText(
  input: ExtractImageTextInput
): Promise<TextractImageResult> {
  const command = new DetectDocumentTextCommand({
    Document: { Bytes: input.bytes },
  });
  const response = await getClient().send(command);
  const blocks = (response.Blocks ?? []) as TextractImageBlock[];
  return normalizeBlocks(blocks);
}