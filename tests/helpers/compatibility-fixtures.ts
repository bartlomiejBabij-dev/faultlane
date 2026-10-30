import path from "node:path";
import { createServer as createPortServer } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import { startTestApi } from "../../examples/test-api/server";

export async function startViteFixture(name: "react-board" | "supabase-tasks", root = path.resolve("examples", name)): Promise<{ server: ViteDevServer; url: string }> {
  // Vite wstrzykuje port WebSocket do klienta przed listen(). Jawny losowy
  // port zapobiega wygenerowaniu adresu HMR :0; polityka runnera nie wymaga wyjątku.
  const portServer = createPortServer();
  await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const available = portServer.address();
  if (!available || typeof available === "string") throw new Error("Could not allocate a local fixture port.");
  const port = available.port;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const server = await createServer({
    root, configFile: false, envFile: false, logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true, hmr: { host: "127.0.0.1", port, clientPort: port } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") { await server.close(); throw new Error("Vite fixture did not bind to loopback."); }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

export async function closeTestApi(fixture: Awaited<ReturnType<typeof startTestApi>>): Promise<void> {
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve()));
}

export { startTestApi };
