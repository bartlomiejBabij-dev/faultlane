import { createServer } from "node:http";
import { once } from "node:events";

// Wyłącznie syntetyczny serwer loopback. Liczniki celowo nie zapisują query,
// nagłówków, cookies ani treści żądań.
export async function startTestApi(port = 0) {
  const requests: { method: string; pathname: string }[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "GET", pathname: url.pathname });
    const origin = request.headers.origin;
    if (origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, x-client-info, prefer, content-type");
      response.setHeader("Access-Control-Expose-Headers", "content-range, retry-after");
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
    if (url.pathname === "/assets/leaf.svg") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>');
      return;
    }
    if (url.pathname === "/v2/redirect") { response.writeHead(302, { Location: "https://never-contact.fixture.invalid/data" }).end(); return; }
    if (url.pathname === "/v2/redirect-local") { response.writeHead(302, { Location: "/unexpected" }).end(); return; }
    const payloads: Record<string, unknown> = {
      "/v2/session": { displayName: "Garden team", permissions: ["read"] },
      "/v2/cards": { cards: [{ id: 11, caption: "Prepare garden map" }, { id: 12, caption: "Check seed supply" }] },
      "/rest/v1/tasks": [{ id: "spruce", label: "Inspect greenhouse" }, { id: "birch", label: "Water seedlings" }],
      "/rest/v1/teams": [{ title: "Orchard crew" }],
      "/unexpected": { shouldNeverBeRequested: true },
    };
    const payload = payloads[url.pathname];
    if (!payload) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "application/json");
    if (url.pathname.startsWith("/rest/v1/")) response.setHeader("Content-Range", `0-${(payload as unknown[]).length - 1}/${(payload as unknown[]).length}`);
    response.writeHead(200).end(JSON.stringify(payload));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API did not bind to loopback.");
  return { server, requests, url: `http://127.0.0.1:${address.port}` };
}
