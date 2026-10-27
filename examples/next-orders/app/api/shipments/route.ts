export async function GET() {
  return Response.json([{ title: "Parcel Aurora" }, { title: "Parcel Beacon" }], { headers: { "Cache-Control": "no-store" } });
}
