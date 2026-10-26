import { startCatalogFixture } from "./server";
const { server, url } = await startCatalogFixture(3100);
console.log(`Independent Cedar fixture: ${url}/catalog`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { process.exitCode = 0; }));
