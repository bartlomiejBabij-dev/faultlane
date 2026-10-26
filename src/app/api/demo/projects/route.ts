export function GET() {
  return Response.json([
    { id: "atlas", name: "Atlas API", description: "Core platform services", language: "TypeScript", owner: "Platform", status: "Active" },
    { id: "orbit", name: "Orbit Dashboard", description: "Customer workspace", language: "TypeScript", owner: "Product", status: "Active" },
    { id: "relay", name: "Relay Worker", description: "Event processing pipeline", language: "JavaScript", owner: "Infrastructure", status: "Active" },
  ], { headers: { "Cache-Control": "no-store" } });
}
