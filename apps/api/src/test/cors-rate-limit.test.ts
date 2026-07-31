import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, beforeEach } from "vitest";
import { corsMiddleware } from "../middleware/core.ts";
import {
  publicAndLlmRateLimitMiddleware,
  resetRateLimitStores,
} from "../middleware/rate-limit.ts";

type MockResponse = {
  headers: Map<string, string>;
  statusCode: number;
  body: unknown;
  ended: boolean;
  setHeader(name: string, value: string): MockResponse;
  status(code: number): MockResponse;
  json(body: unknown): MockResponse;
  end(): MockResponse;
};

function createRequest(method: string, path: string): Request {
  return {
    method,
    path,
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

function createResponse(): MockResponse {
  const response: MockResponse = {
    headers: new Map(),
    statusCode: 200,
    body: undefined,
    ended: false,
    setHeader(name, value) {
      response.headers.set(name, value);
      return response;
    },
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(body) {
      response.body = body;
      return response;
    },
    end() {
      response.ended = true;
      return response;
    },
  };

  return response;
}

function asExpressResponse(response: MockResponse): Response {
  return response as unknown as Response;
}

function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  request: Request,
  response: MockResponse,
): boolean {
  let nextCalled = false;
  middleware(request, asExpressResponse(response), () => {
    nextCalled = true;
  });
  return nextCalled;
}

describe("CORS and rate-limit middleware", () => {
  beforeEach(() => {
    resetRateLimitStores();
  });

  it("completes affiliate job preflights without consuming the LLM quota", () => {
    const limiter = publicAndLlmRateLimitMiddleware();

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = createResponse();
      const nextCalled = runMiddleware(
        limiter,
        createRequest("OPTIONS", "/affiliates/agent/chat/jobs/job_test"),
        response,
      );

      expect(nextCalled).toBe(true);
      expect(response.statusCode).toBe(200);
    }

    const response = createResponse();
    const nextCalled = runMiddleware(
      limiter,
      createRequest("GET", "/affiliates/agent/chat/jobs/job_test"),
      response,
    );

    expect(nextCalled).toBe(true);
    expect(response.statusCode).toBe(200);
  });

  it("keeps the LLM limit for actual affiliate job requests", () => {
    const limiter = publicAndLlmRateLimitMiddleware();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = createResponse();
      const nextCalled = runMiddleware(
        limiter,
        createRequest("GET", "/affiliates/agent/chat/jobs/job_test"),
        response,
      );

      expect(nextCalled).toBe(true);
      expect(response.statusCode).toBe(200);
    }

    const response = createResponse();
    const nextCalled = runMiddleware(
      limiter,
      createRequest("GET", "/affiliates/agent/chat/jobs/job_test"),
      response,
    );

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(429);
  });

  it("sets CORS headers on rate-limit responses when CORS runs first", () => {
    const origin = "https://chronicle-ai-web.vercel.app";
    const cors = corsMiddleware(origin);
    const limiter = publicAndLlmRateLimitMiddleware();

    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = createResponse();
      let limiterCalled = false;
      cors(
        createRequest("GET", "/affiliates/agent/chat/jobs/job_test"),
        asExpressResponse(response),
        () => {
          limiterCalled = true;
          limiter(
            createRequest("GET", "/affiliates/agent/chat/jobs/job_test"),
            asExpressResponse(response),
            () => undefined,
          );
        },
      );

      if (attempt === 20) {
        expect(limiterCalled).toBe(true);
        expect(response.statusCode).toBe(429);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      }
    }
  });

  it("returns a CORS-enabled 204 for browser preflight requests", () => {
    const origin = "https://chronicle-ai-web.vercel.app";
    const response = createResponse();
    const nextCalled = runMiddleware(
      corsMiddleware(origin),
      createRequest("OPTIONS", "/affiliates/agent/chat/jobs/job_test"),
      response,
    );

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
});
