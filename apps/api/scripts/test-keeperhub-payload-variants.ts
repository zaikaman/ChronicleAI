/**
 * Tests KeeperHub workflow execution payload format variants.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

async function testVariant(label: string, bodyObj: any) {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const baseUrl = (process.env.KEEPERHUB_API_BASE_URL || "https://app.keeperhub.com").replace(/\/+$/, "");
  const workflowId = process.env.KEEPERHUB_WORKFLOW_PUBLISH_ALERT;

  const executeUrl = `${baseUrl}/api/workflows/${workflowId}/execute`;
  console.log(`\n--- TESTING PAYLOAD VARIANT: ${label} ---`);
  console.log(`Body: ${JSON.stringify(bodyObj)}`);

  const response = await fetch(executeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyObj),
  });

  const statusCode = response.status;
  const text = await response.text();
  console.log(`Status: ${statusCode} -> ${text}`);

  if (statusCode >= 200 && statusCode < 300) {
    const parsed = JSON.parse(text);
    const execId = parsed.executionId || parsed.id;
    console.log(`Run ID: ${execId}`);
    return execId;
  }
  return null;
}

async function pollExecution(execId: string) {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const baseUrl = (process.env.KEEPERHUB_API_BASE_URL || "https://app.keeperhub.com").replace(/\/+$/, "");
  const statusUrl = `${baseUrl}/api/executions/${execId}`;

  for (let i = 1; i <= 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok) {
      const data = (await res.json()) as any;
      console.log(`Poll ${i}: status=${data.status} error=${data.error ?? "none"}`);
      if (data.status === "success" || data.status === "completed" || data.completed) {
        console.log(`SUCCESS! TxHash: ${data.transactionHash || data.txHash || "N/A"}`);
        return true;
      }
      if (data.status === "error" || data.status === "failed") {
        console.log(`FAILED: ${JSON.stringify(data)}`);
        return false;
      }
    }
  }
}

async function main() {
  loadEnv();

  const sampleHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const sampleEvent = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const sampleUri = "https://chronicle-ai-web.vercel.app/activity";

  // Variant 1: { inputs: { Trigger: { contentHash, sourceEventHash, contentUri } } }
  const exec1 = await testVariant("1. Wrapped in inputs.Trigger", {
    inputs: {
      Trigger: {
        contentHash: sampleHash,
        sourceEventHash: sampleEvent,
        contentUri: sampleUri,
      },
    },
  });

  if (exec1) {
    await pollExecution(exec1);
  }

  // Variant 2: { inputs: { contentHash, sourceEventHash, contentUri } }
  const hash2 = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const exec2 = await testVariant("2. Direct in inputs", {
    inputs: {
      contentHash: hash2,
      sourceEventHash: sampleEvent,
      contentUri: sampleUri,
    },
  });

  if (exec2) {
    await pollExecution(exec2);
  }
}

main().catch(console.error);
