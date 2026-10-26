import { NextResponse } from "next/server";

type NominatimItem = {
  display_name?: string;
};

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (q.length < 3) {
    return NextResponse.json({ suggestions: [] as string[] });
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "0");
    url.searchParams.set("limit", "8");
    url.searchParams.set("countrycodes", "au");
    url.searchParams.set("q", q);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "ShareHouseManagers/1.0 (info@sharehousemanagers.com.au)",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ suggestions: [] as string[] });
    }

    const data = (await res.json()) as NominatimItem[];
    const suggestions = data
      .map((item) => String(item.display_name || "").trim())
      .filter(Boolean);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] as string[] });
  }
}
