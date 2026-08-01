import { randomBytes } from "node:crypto";
import { computeKeeperhubSignature } from "../../apps/api/src/middleware/keeperhub-signature.ts";

export function keeperhubSignatureHeaders(input: {
  secret: string;
  path: string;
  method: string;
  body: string;
}): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");

  return {
    "X-ChronicleAI-Timestamp": String(timestamp),
    "X-ChronicleAI-Nonce": nonce,
    "X-ChronicleAI-Signature": computeKeeperhubSignature({
      secret: input.secret,
      method: input.method,
      path: input.path,
      body: input.body,
      timestamp,
      nonce,
    }),
  };
}
