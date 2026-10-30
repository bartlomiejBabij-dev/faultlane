export function GET() { return Response.json({ nickname: "Harbor operator" }, { headers: { "Cache-Control": "no-store" } }); }
