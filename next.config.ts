import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@aws-sdk/client-textract",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-bedrock-runtime",
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/lib-dynamodb",
    "@aws-sdk/client-sfn",
    "tesseract.js",
  ],
};

export default nextConfig;
