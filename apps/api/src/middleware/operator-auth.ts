// Express middleware: Operator bearer authentication

import type { Request, Response, NextFunction } from "express";
import { unauthorized } from "../errors.ts";

/**
 * Creates middleware that validates bearer auth for operator routes.
 * Returns 401 with a safe response when missing or invalid.
 */
export function operatorAuthMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = authHeader.slice("Bearer ".length);

    if (!token || token !== expectedToken) {
      res.status(401).json({ error: "Invalid operator token" });
      return;
    }

    next();
  };
}
