// Health check route

import { Router, type Router as RouterType } from "express";

const router: RouterType = Router();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "chronicleai-api",
    timestamp: new Date().toISOString(),
  });
});

export { router as healthRoutes };
