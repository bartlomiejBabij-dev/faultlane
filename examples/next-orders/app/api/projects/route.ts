export function GET() { return Response.json({ entries: [{ key: "signal", title: "Signal harbor" }] }, { headers: { "Cache-Control": "no-store" } }); }
