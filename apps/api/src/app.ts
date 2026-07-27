import express, { type Express } from "express";

const app: Express = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export { app };
