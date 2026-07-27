// Test server bootstrap helpers for API integration tests
// Boots HTTP server in tests without listening on a fixed port

import { type Server, createServer } from "node:http";
import type { Express } from "express";

export interface TestServer {
  app: Express;
  server: Server;
  url: string;
  close: () => Promise<void>;
}

/**
 * Creates an HTTP server wrapping an Express app for testing.
 * The server listens on a random available port.
 */
export async function createTestServer(app: Express): Promise<TestServer> {
  const server = createServer(app);

  return new Promise<TestServer>((resolve, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }

      const port = address.port;
      const url = `http://localhost:${port}`;

      resolve({
        app,
        server,
        url,
        close: () => {
          return new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          });
        },
      });
    });
  });
}
