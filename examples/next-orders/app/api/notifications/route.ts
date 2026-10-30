export function GET() { return Response.json({ unread: 3 }, { headers: { "Cache-Control": "no-store" } }); }
