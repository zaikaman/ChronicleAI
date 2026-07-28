// Unit tests for CDP Bearer JWT generation and facilitator auth headers

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildFacilitatorAuthHeaders,
  generateCdpBearerToken,
  importCdpSigningKey,
  isCdpFacilitatorUrl,
} from "../payments/cdp-auth.ts";

/** Build a CDP-style Ed25519 secret: base64(seed || publicKey) = 64 bytes. */
function makeEd25519CdpSecret(): { apiKeyId: string; apiKeySecret: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privJwk = privateKey.export({ format: "jwk" }) as { d?: string; x?: string };
  const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!privJwk.d || !pubJwk.x) {
    throw new Error("Failed to export Ed25519 JWK");
  }
  const seed = Buffer.from(privJwk.d, "base64url");
  const x = Buffer.from(pubJwk.x, "base64url");
  const secret = Buffer.concat([seed, x]).toString("base64");
  return {
    apiKeyId: "00000000-0000-4000-8000-000000000001",
    apiKeySecret: secret,
  };
}

describe("cdp-auth", () => {
  it("detects CDP facilitator URLs", () => {
    expect(isCdpFacilitatorUrl("https://api.cdp.coinbase.com/platform/v2/x402")).toBe(true);
    expect(isCdpFacilitatorUrl("https://x402.org/facilitator")).toBe(false);
    expect(isCdpFacilitatorUrl(undefined)).toBe(false);
  });

  it("imports Ed25519 CDP secrets", async () => {
    const { apiKeySecret } = makeEd25519CdpSecret();
    const { alg } = await importCdpSigningKey(apiKeySecret);
    expect(alg).toBe("EdDSA");
  });

  it("generates a three-part JWT bound to method/host/path", async () => {
    const creds = makeEd25519CdpSecret();
    const token = await generateCdpBearerToken({
      apiKeyId: creds.apiKeyId,
      apiKeySecret: creds.apiKeySecret,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/x402/settle",
    });

    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as {
      alg: string;
      kid: string;
      typ: string;
    };
    expect(header.alg).toBe("EdDSA");
    expect(header.kid).toBe(creds.apiKeyId);
    expect(header.typ).toBe("JWT");

    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      sub: string;
      iss: string;
      uri: string;
      aud: string[];
    };
    expect(payload.sub).toBe(creds.apiKeyId);
    expect(payload.iss).toBe("cdp");
    expect(payload.aud).toContain("cdp_service");
    expect(payload.uri).toBe("POST api.cdp.coinbase.com/platform/v2/x402/settle");
  });

  it("omits Authorization when credentials are missing", async () => {
    const headers = await buildFacilitatorAuthHeaders(
      "https://api.cdp.coinbase.com/platform/v2/x402/settle",
      undefined,
    );
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
  });

  it("attaches Bearer token when credentials are present", async () => {
    const creds = makeEd25519CdpSecret();
    const headers = await buildFacilitatorAuthHeaders(
      "https://api.cdp.coinbase.com/platform/v2/x402/settle",
      { apiKeyId: creds.apiKeyId, apiKeySecret: creds.apiKeySecret },
    );
    expect(headers.Authorization).toMatch(/^Bearer eyJ/);
  });
});
