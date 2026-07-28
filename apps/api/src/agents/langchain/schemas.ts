/**
 * Shared Zod response schemas for LangChain structured agents.
 */

import { z } from "zod";

export const confidenceSchema = z.enum(["high", "medium", "low"]);

export const alertContentSchema = z.object({
  title: z.string().describe("Short public alert headline"),
  summary: z.string().describe("Plain-language alert summary (2–4 sentences)"),
  confidence: confidenceSchema,
});

export const digestContentSchema = z.object({
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  analysis: z.string().optional(),
  confidence: confidenceSchema,
  sections: z
    .object({
      capitalDirection: z.string().optional(),
      exchangeAndProtocolFlows: z.string().optional(),
      stressBoard: z.string().optional(),
      storyOfTheDay: z.string().optional(),
      coverageNote: z.string().optional(),
    })
    .optional(),
});

export const premiumNarrativeSchema = z.object({
  summaryPublic: z.string().describe("Public teaser for unpaid catalog card"),
  sections: z.array(
    z.object({
      title: z.string(),
      body: z.string().optional(),
      findings: z.array(z.string()).optional(),
    }),
  ),
  analysis: z.string(),
  confidence: confidenceSchema,
});

export const deskProposalSchema = z.object({
  action: z.enum(["propose", "hold", "defer", "defend"]),
  strategy: z
    .enum(["risk_defend", "yield_rotation", "oracle_amm"])
    .nullable()
    .optional(),
  notionalUsdc: z.number(),
  priority: z.number().optional(),
  confidence: z.number(),
  thesis: z.string(),
  riskNotes: z.array(z.string()).optional(),
  legsHint: z.array(z.string()).optional(),
  declineReasons: z.array(z.string()).optional(),
});

export const failureClassificationSchema = z.object({
  nextStep: z.enum(["retry_smaller", "cooldown", "arm_kill", "hold", "ignore"]),
  confidence: z.number(),
  reason: z.string(),
});

export const signalFusionSchema = z.object({
  label: z.enum(["actionable", "data_quality", "noise", "wait_for_confirm"]),
  confidence: z.number(),
  reason: z.string(),
});

export const ticketNarrativeSchema = z.object({
  summary: z.string(),
  editorialBody: z.string().optional(),
});
