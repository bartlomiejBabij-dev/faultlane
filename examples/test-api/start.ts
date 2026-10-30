import { startTestApi } from "./server";
const fixture = await startTestApi(Number(process.env.PORT ?? "3103"));
console.log(`Synthetic loopback REST API: ${fixture.url}`);
