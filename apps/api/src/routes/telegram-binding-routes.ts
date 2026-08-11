import type { TelegramBindingRepository } from "@chronicleai/db";
import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import { Router, type Router as RouterType } from "express";

const WALLET_LINK_MAX_AGE_MS = 15 * 60 * 1000;

export function buildTelegramWalletLinkMessage(
  walletAddress: string,
  issuedAt: string,
  token: string,
): string {
  return [
    "ChronicleAI Telegram Watch Link",
    `Wallet: ${walletAddress.trim().toLowerCase()}`,
    `Issued-At: ${issuedAt}`,
    `Binding-Token: ${token.trim()}`,
    "Purpose: Link this wallet to my ChronicleAI Telegram Watch alerts",
  ].join("\n");
}

function bodyObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

async function verifyWalletLink(body: Record<string, unknown>, token: string): Promise<string> {
  const walletRaw = requiredString(body, "walletAddress", 42);
  if (!isAddress(walletRaw, { strict: false })) throw new Error("Invalid walletAddress");
  const wallet = getAddress(walletRaw).toLowerCase();
  const issuedAt = requiredString(body, "issuedAt", 64);
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) throw new Error("Invalid issuedAt timestamp");
  const age = Date.now() - issuedMs;
  if (age < -60_000 || age > WALLET_LINK_MAX_AGE_MS) {
    throw new Error("Wallet link signature expired; please sign again");
  }
  const signature = requiredString(body, "signature", 256);
  if (!signature.startsWith("0x")) throw new Error("Invalid wallet signature");
  const recovered = (
    await recoverMessageAddress({
      message: buildTelegramWalletLinkMessage(wallet, issuedAt, token),
      signature: signature as Hex,
    })
  ).toLowerCase();
  if (recovered !== wallet) throw new Error("Wallet signature does not match walletAddress");
  return wallet;
}

export type TelegramBindingRouteDeps = {
  bindingRepo: TelegramBindingRepository;
};

export function createTelegramBindingRoutes(deps: TelegramBindingRouteDeps): RouterType {
  const router: RouterType = Router();

  router.post("/telegram/binding/link", async (req, res, _next) => {
    try {
      const body = bodyObject(req.body);
      const token = requiredString(body, "token", 256);
      const binding = await deps.bindingRepo.findPersistentByToken(token);
      if (!binding.ok) {
        res.status(500).json({ error: binding.error.message });
        return;
      }
      if (!binding.value) {
        res.status(401).json({ error: "Telegram binding is invalid or revoked" });
        return;
      }

      const wallet = await verifyWalletLink(body, token);
      const updated = await deps.bindingRepo.update(binding.value.id, {
        wallet_address: wallet,
      });
      if (!updated.ok) {
        res.status(500).json({ error: updated.error.message });
        return;
      }
      res.json({ linked: true, walletAddress: wallet });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid wallet link" });
    }
  });

  router.post("/telegram/binding/revoke", async (req, res, next) => {
    try {
      const token = requiredString(bodyObject(req.body), "token", 256);
      const binding = await deps.bindingRepo.findPersistentByToken(token);
      if (!binding.ok) {
        res.status(500).json({ error: binding.error.message });
        return;
      }
      if (!binding.value) {
        res.status(204).end();
        return;
      }
      const revoked = await deps.bindingRepo.update(binding.value.id, {
        revoked_at: new Date().toISOString(),
      });
      if (!revoked.ok) {
        res.status(500).json({ error: revoked.error.message });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
