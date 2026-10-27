import { startCatalogFixture } from "./server";
const port = Number(process.env.PORT ?? 3100);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer between 0 and 65535.");
const { server, url } = await startCatalogFixture(port);
console.log(`Independent Cedar fixture: ${url}/catalog`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { process.exitCode = 0; }));
