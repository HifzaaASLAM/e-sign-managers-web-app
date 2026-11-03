import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NominatimAddress = {
  house_number?: string;
  unit?: string;
  road?: string;
  pedestrian?: string;
  suburb?: string;
  city_district?: string;
  town?: string;
  city?: string;
  municipality?: string;
  state?: string;
  postcode?: string;
};

type NominatimItem = {
  display_name?: string;
  address?: NominatimAddress;
};

type ParsedQuery = {
  raw: string;
  unitHouse: string | null;
  unitLabel: string | null;
  houseNumber: string | null;
  postcode: string | null;
  state: string | null;
  streetPart: string;
  suburbPart: string;
  /** Free-text tokens (e.g. partial street name) not already in street/suburb */
  freeText: string;
};

const AU_STATE_RE =
  /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT|New South Wales|Victoria|Queensland|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory)\b/i;

const ROAD_TYPE_RE =
  /\b(street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|parade|pde|crescent|cres|lane|ln|way|boulevard|blvd|close|cl|grove|gr|terrace|tce|circuit|cct|highway|hwy|esplanade|esp)\b/i;

function abbrevAuState(state: string) {
  const s = state.trim().toLowerCase();
  if (s === "vic" || s.includes("victoria")) return "VIC";
  if (s === "nsw" || s.includes("new south wales")) return "NSW";
  if (s === "qld" || s.includes("queensland")) return "QLD";
  if (s === "sa" || s.includes("south australia")) return "SA";
  if (s === "wa" || s.includes("western australia")) return "WA";
  if (s === "tas" || s.includes("tasmania")) return "TAS";
  if (s === "nt" || s.includes("northern territory")) return "NT";
  if (s === "act" || s.includes("australian capital territory")) return "ACT";
  return state.trim();
}

function hasRoadTypeToken(text: string) {
  return ROAD_TYPE_RE.test(text);
}

function looksLikeStreetLine(text: string) {
  const s = text.trim();
  if (!s) return false;
  if (/^\d+\/\d+(\s+\S+)?$/i.test(s)) return true;
  if (/^\d+\s+\S+/i.test(s)) return true;
  if (/^(unit|suite|level|shop|apt|apartment|flat)\s+\d+/i.test(s)) return true;
  if (hasRoadTypeToken(s)) return true;
  return false;
}

function streetFragmentAfterUnit(parsed: ParsedQuery) {
  if (!parsed.unitHouse) return "";
  return parsed.streetPart
    .replace(new RegExp(`^${parsed.unitHouse.replace(/\//g, "\\/")}\\s+`, "i"), "")
    .trim();
}

function passesUnitFilter(line: string, parsed: ParsedQuery) {
  if (!parsed.unitHouse) return true;
  const street = line.split(",")[0]?.trim() || "";
  if (street === parsed.unitHouse || street.startsWith(`${parsed.unitHouse} `)) return true;
  return false;
}

const QUERY_STOP_WORDS = new Set([
  "street", "st", "road", "rd", "avenue", "ave", "drive", "dr", "unit", "suite", "level",
  "shop", "flat", "apt", "apartment", "the", "and", "australia",
  "nsw", "vic", "qld", "sa", "wa", "tas", "nt", "act",
]);

/** Partial type-ahead: "mui" must match "Muir", not "M Street". */
function roadMatchesPartialFragment(street: string, frag: string) {
  if (!frag || frag.length < 2) return true;
  return wordMatchesInStreet(frag, street);
}

function meaningfulQueryWords(parsed: ParsedQuery): string[] {
  const unit = parsed.unitHouse?.toLowerCase() || "";
  const words: string[] = [];
  for (const t of parsed.raw.toLowerCase().replace(/[^\w\s/]/g, " ").split(/\s+/)) {
    if (t.length < 2 || QUERY_STOP_WORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (unit && (t === unit || t === unit.replace("/", ""))) continue;
    if (unit?.includes("/")) {
      const [u0, u1] = unit.split("/");
      if (t === u0 || t === u1) continue;
    }
    words.push(t);
  }
  return words;
}

/** Universal: typed word must appear in line or as prefix of a road name token. */
function wordMatchesInStreet(word: string, street: string) {
  const w = word.toLowerCase().trim();
  if (!w) return true;
  const streetLower = street.toLowerCase();
  if (streetLower.includes(w)) return true;

  let roadPart = streetLower.replace(/^\d+\/\d+\s+/, "").replace(/^\d+\s+/, "");
  roadPart = roadPart.replace(ROAD_TYPE_RE, " ").replace(/\s+/g, " ").trim();
  const tokens = roadPart.split(/\s+/).filter((t) => t.length >= 2 && !QUERY_STOP_WORDS.has(t));
  return tokens.some((t) => t.startsWith(w) || (w.length >= 3 && t.includes(w)));
}

function wordMatchesLine(word: string, line: string, street: string) {
  const w = word.toLowerCase();
  if (line.toLowerCase().includes(w)) return true;
  return wordMatchesInStreet(w, street);
}

/** Every word the user typed (except unit) must match the suggestion. */
function matchesAllQueryWords(line: string, parsed: ParsedQuery) {
  const street = line.split(",")[0]?.trim() || line;
  const words = meaningfulQueryWords(parsed);
  if (words.length === 0) return true;
  return words.every((w) => wordMatchesLine(w, line, street));
}

function queryMatchTokens(parsed: ParsedQuery): string[] {
  const tokens = new Set<string>();
  const frag = streetFragmentAfterUnit(parsed);
  if (frag && frag.length >= 2) tokens.add(frag.toLowerCase());

  for (const t of parsed.raw.toLowerCase().replace(/[^\w\s/]/g, " ").split(/\s+/)) {
    if (t.length < 2 || QUERY_STOP_WORDS.has(t) || /^\d+$/.test(t)) continue;
    if (parsed.unitHouse && t === parsed.unitHouse.toLowerCase()) continue;
    tokens.add(t);
  }
  if (parsed.suburbPart && parsed.suburbPart.length >= 3) {
    tokens.add(parsed.suburbPart.toLowerCase());
  }
  return [...tokens];
}

function isWeakSyntheticStreet(street: string, parsed: ParsedQuery) {
  if (/^\d+\/\d+\s+(street|st|road|rd|way|close)$/i.test(street.trim())) return true;
  if (parsed.unitHouse && street.trim() === parsed.unitHouse) return true;
  return false;
}

function isJunkStreetName(street: string) {
  return /\b(reserve|rest area|national park|memorial park|car park|playground|cemetery|lake)\b/i.test(
    street,
  );
}

function hasProperLocality(line: string, parsed: ParsedQuery) {
  const loc = extractLocalityFromSuggestion(line);
  if (!line.includes(",") && (parsed.suburbPart || parsed.postcode)) return false;
  if (!loc && (parsed.suburbPart || parsed.postcode)) return false;

  if (parsed.suburbPart && !loc.toLowerCase().includes(parsed.suburbPart.toLowerCase())) {
    return false;
  }
  if (parsed.postcode && !line.includes(parsed.postcode)) return false;
  if (parsed.state && !line.toUpperCase().includes(parsed.state) && parsed.postcode) {
    return false;
  }
  if (parsed.suburbPart || parsed.postcode) {
    if (parsed.postcode && loc.includes(parsed.postcode)) return true;
    if (parsed.suburbPart && loc.toLowerCase().includes(parsed.suburbPart.toLowerCase())) return true;
    return /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4}\b/.test(line);
  }
  return true;
}

function minimumScore(parsed: ParsedQuery): number {
  const words = meaningfulQueryWords(parsed);
  let min = 4 + words.length * 3;
  if (parsed.unitHouse) min += 2;
  return min;
}

function hasAuLocalityTail(line: string, parsed?: ParsedQuery) {
  if (!line.includes(",")) return false;
  if (/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4}\b/.test(line)) return true;
  const loc = extractLocalityFromSuggestion(line);
  if (!/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/.test(line)) return false;
  if (parsed?.suburbPart && loc.toLowerCase().includes(parsed.suburbPart.toLowerCase())) return true;
  return false;
}

/** Strong gate: unit prefix, query token overlap, suburb/postcode, no junk rows. */
function passesStrongFilter(line: string, parsed: ParsedQuery, score: number) {
  if (!line || !passesUnitFilter(line, parsed)) return false;

  const street = line.split(",")[0]?.trim() || "";
  const lower = line.toLowerCase();

  if (!looksLikeStreetLine(street)) return false;
  if (isJunkStreetName(street)) return false;
  if (isWeakSyntheticStreet(street, parsed)) return false;

  if (parsed.unitHouse) {
    const afterUnit = street.slice(parsed.unitHouse.length).trim();
    if (afterUnit && !hasRoadTypeToken(afterUnit)) {
      const nameParts = afterUnit.split(/\s+/).filter((w) => !QUERY_STOP_WORDS.has(w.toLowerCase()));
      if (nameParts.length < 1 && !parsed.suburbPart && !parsed.postcode) return false;
    }
  }

  if (!matchesAllQueryWords(line, parsed)) return false;

  const frag = streetFragmentAfterUnit(parsed);
  if (frag && frag.length >= 2 && !roadMatchesPartialFragment(street, frag)) return false;

  if (!hasAuLocalityTail(line, parsed)) return false;

  if (!hasProperLocality(line, parsed)) return false;

  if (parsed.houseNumber && !parsed.unitHouse) {
    if (!street.startsWith(`${parsed.houseNumber} `)) return false;
  }

  if (score < minimumScore(parsed)) return false;
  return true;
}

function enforceUnitPrefix(street: string, parsed: ParsedQuery) {
  if (!parsed.unitHouse || !street) return street;
  const s = street.trim();
  if (s.startsWith(`${parsed.unitHouse} `) || s === parsed.unitHouse) return s;
  if (s.includes("/")) return s;
  const wrongHouse = s.match(/^(\d+)\s+/);
  if (wrongHouse && wrongHouse[1] !== parsed.unitHouse.split("/")[1]) {
    return s;
  }
  const frag = streetFragmentAfterUnit(parsed);
  if (!/^\d/.test(s)) {
    if (frag && frag.length >= 2 && !roadMatchesPartialFragment(s, frag)) return s;
    return `${parsed.unitHouse} ${s}`.trim();
  }
  const hnOnly = s.match(/^(\d+)\s+(.+)$/);
  const unitParts = parsed.unitHouse.split("/");
  const housePart = unitParts[1];
  if (hnOnly && unitParts.length === 2) {
    if (hnOnly[1] === housePart || hnOnly[1] === unitParts[0]) {
      return `${parsed.unitHouse} ${hnOnly[2]}`.trim();
    }
  }
  return s;
}

function titleCaseWords(text: string) {
  return text
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function parseAustralianQuery(raw: string): ParsedQuery {
  let q = raw.trim().replace(/\s+/g, " ");
  let unitHouse: string | null = null;
  let unitLabel: string | null = null;
  let houseNumber: string | null = null;

  const uh = q.match(/^(\d+\/\d+)(?:\s+(.*))?$/i);
  if (uh) {
    unitHouse = uh[1];
    q = (uh[2] || "").trim();
  }

  const ul = q.match(/^(unit|suite|level|shop|apt|apartment|flat)\s*(\d+[a-z]?)\s*,?\s*/i);
  if (ul) {
    unitLabel = `${ul[1][0].toUpperCase()}${ul[1].slice(1).toLowerCase()} ${ul[2]}`;
    q = q.slice(ul[0].length);
  }

  if (!unitHouse) {
    const hn = q.match(/^(\d+[a-z]?)\s+/);
    if (hn) {
      houseNumber = hn[1];
      q = q.slice(hn[0].length);
    }
  }

  const postcode = q.match(/\b(\d{4})\b/)?.[1] ?? null;
  const stateMatch = q.match(AU_STATE_RE);
  const state = stateMatch ? abbrevAuState(stateMatch[1]) : null;

  let locality = q
    .replace(/\b\d{4}\b/g, " ")
    .replace(AU_STATE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  const commaParts = locality.split(",").map((p) => p.trim()).filter(Boolean);
  let streetPart = commaParts[0] || locality;
  let suburbPart = commaParts.slice(1).join(", ").trim();

  if (!suburbPart && commaParts.length === 1) {
    const tokens = streetPart.split(/\s+/);
    const roadIdx = tokens.findIndex((t) =>
      /^(street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|parade|pde|crescent|cres|lane|ln|way|boulevard|blvd|close|cl|grove|gr|terrace|tce)$/i.test(
        t,
      ),
    );
    if (roadIdx >= 0 && roadIdx < tokens.length - 1) {
      suburbPart = tokens.slice(roadIdx + 1).join(" ");
      streetPart = tokens.slice(0, roadIdx + 1).join(" ");
    } else if (tokens.length >= 2 && !hasRoadTypeToken(streetPart) && !houseNumber && !unitLabel) {
      suburbPart = tokens[tokens.length - 1];
      streetPart = tokens.slice(0, -1).join(" ");
    } else if (tokens.length === 1 && !hasRoadTypeToken(streetPart) && !houseNumber && !unitHouse && !unitLabel) {
      suburbPart = streetPart;
      streetPart = "";
    }
  }

  const prefix = [unitHouse, unitLabel, houseNumber].filter(Boolean).join(" ").trim();
  if (prefix && streetPart && !streetPart.startsWith(prefix)) {
    streetPart = `${prefix} ${streetPart}`.trim();
  } else if (prefix && !streetPart) {
    streetPart = prefix;
  }

  const used = new Set(
    [streetPart, suburbPart, unitHouse, unitLabel, houseNumber, postcode, state]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .split(/\s+/),
  );
  const freeText = raw
    .toLowerCase()
    .replace(/[^\w\s/]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !used.has(t))
    .join(" ");

  return {
    raw: raw.trim().replace(/\s+/g, " "),
    unitHouse,
    unitLabel,
    houseNumber,
    postcode,
    state,
    streetPart: streetPart.trim(),
    suburbPart: suburbPart.trim(),
    freeText,
  };
}

function formatAuStreetLine(address: NominatimAddress) {
  const road = String(address.road || address.pedestrian || "").trim();
  const hn = String(address.house_number || "").trim();
  const unit = String(address.unit || "").trim();

  if (hn && hn.includes("/")) {
    return road ? `${hn} ${road}`.trim() : hn;
  }
  if (unit && hn) {
    return road ? `${unit}/${hn} ${road}`.trim() : `${unit}/${hn}`;
  }
  if (hn) {
    return road ? `${hn} ${road}`.trim() : hn;
  }
  return road;
}

function mergeQueryIntoStreet(street: string, parsed: ParsedQuery) {
  if (!street) return street;
  let s = enforceUnitPrefix(street.trim(), parsed);

  if (parsed.unitHouse) {
    if (s.startsWith(`${parsed.unitHouse} `) || s === parsed.unitHouse) {
      // already unit-prefixed
    } else if (!s.includes("/")) {
      const hnOnly = s.match(/^(\d+)\s+(.+)$/);
      const houseFromUnit = parsed.unitHouse.split("/")[1];
      if (hnOnly && hnOnly[1] === houseFromUnit) {
        s = `${parsed.unitHouse} ${hnOnly[2]}`.trim();
      } else if (!/^\d/.test(s)) {
        s = `${parsed.unitHouse} ${s}`.trim();
      }
    }
  }

  if (parsed.unitLabel && !new RegExp(parsed.unitLabel.replace(/\s+/g, "\\s+"), "i").test(s)) {
    if (!/^\d/.test(s) && !/^unit/i.test(s)) {
      s = `${parsed.unitLabel} ${s}`.trim();
    }
  }

  if (parsed.houseNumber && !parsed.unitHouse) {
    if (!/^\d/.test(s)) {
      s = `${parsed.houseNumber} ${s}`.trim();
    }
  }

  if (parsed.streetPart && looksLikeStreetLine(parsed.streetPart)) {
    const sp = parsed.streetPart.toLowerCase();
    const sl = s.toLowerCase();
    if (!sl.includes(sp.split(/\s+/)[0]) && sp.length > 2 && !hasRoadTypeToken(s)) {
      s = `${parsed.streetPart} ${s}`.trim();
    }
  } else if (parsed.streetPart && !hasRoadTypeToken(s) && !/^\d/.test(s)) {
    const fragment = parsed.streetPart.replace(/^\d+\/\d+\s+/, "").trim();
    if (fragment && fragment.length >= 2) {
      const road = hasRoadTypeToken(fragment) ? fragment : `${titleCaseWords(fragment)} Street`;
      if (!s.toLowerCase().includes(fragment.toLowerCase())) {
        s = `${mergeQueryIntoStreet(road, parsed)}`.trim();
      }
    }
  }

  return s;
}

function formatLocality(suburb: string, state: string, postcode: string) {
  return [suburb, [state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(" ");
}

function formatProperAuLine(street: string, locality: string) {
  const s = street.trim();
  const loc = locality.trim();
  if (!s) return loc;
  if (!loc) return s;
  if (loc.toLowerCase() === s.toLowerCase()) return s;
  if (s.includes(",")) return s;
  return `${s}, ${loc}`;
}

function extractLocalityFromSuggestion(line: string) {
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(1).join(", ");
}

function finalizeSuggestion(rawLine: string, parsed: ParsedQuery, address?: NominatimAddress): string | null {
  let line = rawLine.trim();
  if (!line) return null;

  let street = line.split(",")[0]?.trim() || line;
  let locality = extractLocalityFromSuggestion(line);

  if (address) {
    const osmStreet = mergeQueryIntoStreet(formatAuStreetLine(address), parsed);
    const suburb = String(
      address.suburb || address.city_district || address.town || address.city || address.municipality || "",
    ).trim();
    const state = abbrevAuState(String(address.state || ""));
    const postcode = String(address.postcode || "").trim();
    const osmLocality = formatLocality(suburb, state, postcode);

    if (osmStreet) street = osmStreet;
    if (osmLocality) locality = osmLocality || locality;
  } else {
    street = mergeQueryIntoStreet(street, parsed);
  }

  if (!looksLikeStreetLine(street)) {
    if (parsed.streetPart && looksLikeStreetLine(parsed.streetPart)) {
      street = mergeQueryIntoStreet(parsed.streetPart, parsed);
    } else if (address?.road) {
      street = mergeQueryIntoStreet(formatAuStreetLine(address), parsed);
    } else {
      return null;
    }
  }

  if (!locality && parsed.suburbPart) {
    locality = formatLocality(
      titleCaseWords(parsed.suburbPart),
      parsed.state || "",
      parsed.postcode || "",
    );
  }

  if (parsed.postcode && !locality.includes(parsed.postcode)) {
    locality = formatLocality(
      parsed.suburbPart ? titleCaseWords(parsed.suburbPart) : locality.split(/\s+/)[0] || "",
      parsed.state || (locality.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/)?.[1] ?? ""),
      parsed.postcode,
    );
  }

  street = enforceUnitPrefix(street, parsed);
  line = formatProperAuLine(street, locality);
  if (!looksLikeStreetLine(street)) return null;
  if (parsed.unitHouse && !passesUnitFilter(line, parsed)) return null;
  if (isWeakSyntheticStreet(street, parsed)) return null;
  if (isJunkStreetName(street)) return null;
  return line;
}

function formatAuSuggestion(item: NominatimItem, parsed: ParsedQuery) {
  const address = item.address;
  if (!address) {
    const raw = String(item.display_name || "").trim();
    return finalizeSuggestion(raw, parsed);
  }

  const suburb = String(
    address.suburb || address.city_district || address.town || address.city || address.municipality || "",
  ).trim();
  const state = abbrevAuState(String(address.state || ""));
  const postcode = String(address.postcode || "").trim();
  const street = mergeQueryIntoStreet(formatAuStreetLine(address), parsed);
  const locality = formatLocality(suburb, state, postcode);
  const draft = formatProperAuLine(street || String(item.display_name || "").split(",")[0], locality);
  return finalizeSuggestion(draft, parsed, address);
}

function normalizeAuSearchQuery(raw: string) {
  let q = raw.trim().replace(/\s+/g, " ");
  q = q.replace(/\s*,\s*/g, ", ");
  return q;
}

function buildPrimarySearchQuery(parsed: ParsedQuery): string {
  const frag = streetFragmentAfterUnit(parsed);
  const parts: string[] = [];

  if (parsed.unitHouse) parts.push(parsed.unitHouse);
  else if (parsed.unitLabel) parts.push(parsed.unitLabel);
  else if (parsed.houseNumber) parts.push(parsed.houseNumber);

  if (frag) {
    parts.push(hasRoadTypeToken(frag) ? frag : `${titleCaseWords(frag)} Street`);
  } else if (parsed.streetPart) {
    const sp = parsed.streetPart.replace(/^\d+\/\d+\s+/, "").trim();
    if (sp) parts.push(hasRoadTypeToken(sp) ? sp : sp);
  }

  if (parsed.suburbPart) parts.push(titleCaseWords(parsed.suburbPart));
  if (parsed.state) parts.push(parsed.state);
  if (parsed.postcode) parts.push(parsed.postcode);
  parts.push("Australia");

  const built = parts.join(" ").replace(/\s+/g, " ").trim();
  if (built.length >= 3) return built;
  return `${parsed.raw} Australia`.trim();
}

type PhotonFeature = {
  properties?: Record<string, string | undefined>;
};

function photonMatchesSuburbHint(item: NominatimItem, suburbPart: string) {
  if (!suburbPart) return true;
  const hint = suburbPart.toLowerCase();
  const addr = item.address || {};
  const hay = [
    item.display_name,
    addr.suburb,
    addr.city,
    addr.town,
    addr.municipality,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(hint);
}

async function fetchPhoton(q: string, suburbHint?: string): Promise<NominatimItem[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "12");
  url.searchParams.set("lang", "en");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return [];

  const json = (await res.json()) as { features?: PhotonFeature[] };
  const items: NominatimItem[] = [];

  for (const feature of json.features || []) {
    const p = feature.properties || {};
    if ((p.countrycode || "").toUpperCase() !== "AU") continue;

    const road = String(p.street || "").trim();
    if (!road) continue;

    const suburb = String(p.district || p.city || "").trim();
    const state = String(p.state || "").trim();
    const postcode = String(p.postcode || "").trim();
    const hn = String(p.housenumber || "").trim();

    const item: NominatimItem = {
      display_name: [hn, road, suburb, state, postcode, "Australia"].filter(Boolean).join(", "),
      address: {
        house_number: hn || undefined,
        road,
        suburb: suburb || undefined,
        city: p.city,
        state: state || undefined,
        postcode: postcode || undefined,
      },
    };
    if (!photonMatchesSuburbHint(item, suburbHint || "")) continue;
    items.push(item);
  }

  return items;
}

function buildSearchQueries(parsed: ParsedQuery): string[] {
  const q = parsed.raw;
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t.length >= 2 && !/^\d+\/\d+$/.test(t)) out.add(t);
  };

  const frag = streetFragmentAfterUnit(parsed);
  const unitOnly = parsed.unitHouse && !frag && !parsed.suburbPart;

  if (unitOnly) {
    add(`${parsed.unitHouse} street Australia`);
    add(`${parsed.unitHouse} road Australia`);
    return [...out];
  }

  if (parsed.unitHouse && frag && parsed.suburbPart) {
    add(`${parsed.unitHouse} ${titleCaseWords(frag)} Street ${parsed.suburbPart} Australia`);
    add(`${parsed.unitHouse} ${frag} ${parsed.suburbPart}`);
    add(q.replace(/,/g, " "));
    return [...out].slice(0, 3);
  }

  if (parsed.unitHouse && frag) {
    add(`${parsed.unitHouse} ${frag} Australia`);
    add(`${parsed.unitHouse} ${frag} street Australia`);
    if (!hasRoadTypeToken(frag)) {
      add(`${parsed.unitHouse} ${titleCaseWords(frag)} Street Australia`);
      add(`${titleCaseWords(frag)} Street Australia`);
      add(`${frag} street Australia`);
    }
    if (parsed.suburbPart) {
      add(`${parsed.unitHouse} ${titleCaseWords(frag)} Street ${parsed.suburbPart} Australia`);
    }
    add(q.replace(/,/g, " "));
    return [...out].slice(0, 5);
  }

  add(q);
  add(q.replace(/,/g, " "));
  add(q.replace(/\s*,\s*/g, " "));

  if (parsed.postcode) {
    add(`${q} Australia`);
    if (parsed.streetPart) add(`${parsed.streetPart} ${parsed.postcode}`);
    if (parsed.suburbPart) {
      add(`${parsed.suburbPart} ${parsed.state || ""} ${parsed.postcode}`.replace(/\s+/g, " ").trim());
    }
  }

  if (parsed.unitHouse) {
    add(q.replace(/^\d+\/\d+\s+/, ""));
    add(q.replace(/^\d+\/\d+\s+/, "").replace(/,/g, " "));
  }

  if (parsed.streetPart && parsed.suburbPart) {
    add(`${parsed.streetPart} ${parsed.suburbPart}`);
    add(`${parsed.streetPart} Street ${parsed.suburbPart}`);
    add(`${parsed.streetPart} Road ${parsed.suburbPart}`);
    if (parsed.state) add(`${parsed.streetPart} ${parsed.suburbPart} ${parsed.state}`);
    if (parsed.postcode) add(`${parsed.streetPart} ${parsed.suburbPart} ${parsed.postcode}`);
  }

  if (parsed.suburbPart && !parsed.streetPart) {
    add(`${parsed.suburbPart} ${parsed.state || ""} ${parsed.postcode || ""}`.replace(/\s+/g, " ").trim());
    add(`${parsed.suburbPart} street Australia`);
    add(`${parsed.suburbPart} road Australia`);
  }

  if (parsed.streetPart && !hasRoadTypeToken(parsed.streetPart) && parsed.suburbPart) {
    add(`${parsed.streetPart} Street, ${parsed.suburbPart} Australia`);
  }

  if (/^\d{4}$/.test(q)) {
    add(`${q} Australia`);
  }

  return [...out].slice(0, 5);
}

function normalizeTypedSuggestion(parsed: ParsedQuery): string | null {
  if (parsed.raw.length < 3) return null;

  const frag = streetFragmentAfterUnit(parsed);
  if (parsed.unitHouse && !frag && !parsed.suburbPart && !parsed.postcode) {
    return null;
  }
  if (frag && frag.length >= 2 && frag.length <= 6 && !parsed.suburbPart && !parsed.postcode) {
    return null;
  }

  let street = parsed.streetPart;
  if (street && !looksLikeStreetLine(street) && !parsed.suburbPart) {
    return null;
  }
  if (street && !looksLikeStreetLine(street) && parsed.suburbPart) {
    street = `${titleCaseWords(street.replace(/^\d+\/\d+\s+/, "").trim())} Street`;
    street = mergeQueryIntoStreet(street, parsed);
  } else if (street && parsed.unitHouse && !hasRoadTypeToken(street)) {
    const frag = streetFragmentAfterUnit(parsed);
    if (frag) {
      street = mergeQueryIntoStreet(`${titleCaseWords(frag)} Street`, parsed);
    }
  }

  if (!street || !looksLikeStreetLine(street)) {
    if (!parsed.unitHouse && !parsed.houseNumber) return null;
    street = mergeQueryIntoStreet(street || parsed.raw.split(",")[0], parsed);
  }

  const locality = formatLocality(
    parsed.suburbPart ? titleCaseWords(parsed.suburbPart) : "",
    parsed.state || "",
    parsed.postcode || "",
  );

  const line = formatProperAuLine(mergeQueryIntoStreet(street, parsed), locality);
  const finalized = finalizeSuggestion(line, parsed);
  if (!finalized) return null;
  const score = 1000 + suggestionScore(finalized, parsed);
  return passesStrongFilter(finalized, parsed, score) ? finalized : null;
}

function suggestionScore(line: string, parsed: ParsedQuery): number {
  const lower = line.toLowerCase();
  let score = 0;
  const street = line.split(",")[0]?.toLowerCase() || lower;
  if (looksLikeStreetLine(street)) score += 5;

  const tokens = parsed.raw
    .toLowerCase()
    .replace(/[^\w\s/]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  for (const w of meaningfulQueryWords(parsed)) {
    if (wordMatchesLine(w, line, line.split(",")[0] || line)) score += 6;
  }
  if (parsed.postcode && line.includes(parsed.postcode)) score += 3;
  if (parsed.unitHouse && line.includes(parsed.unitHouse)) score += 6;
  if (parsed.state && line.includes(parsed.state)) score += 2;
  if (parsed.suburbPart && lower.includes(parsed.suburbPart.toLowerCase())) score += 5;
  if (hasRoadTypeToken(street)) score += 3;
  if (isJunkStreetName(street)) score -= 20;
  if (isWeakSyntheticStreet(street, parsed)) score -= 20;
  for (const t of queryMatchTokens(parsed)) {
    if (street.includes(t) || lower.includes(t)) score += 2;
  }
  return score;
}

async function fetchNominatim(q: string, featuretype?: string): Promise<NominatimItem[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "10");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("q", q);
  if (featuretype) url.searchParams.set("featuretype", featuretype);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "ShareHouseManagers/1.0 (info@sharehousemanagers.com.au)",
      Referer: "https://sharehousemanagers.com/",
    },
    cache: "no-store",
  });

  if (!res.ok) return [];
  return (await res.json()) as NominatimItem[];
}

async function fetchNominatimStructured(parsed: ParsedQuery): Promise<NominatimItem[]> {
  const street = parsed.streetPart.replace(/^\d+\/\d+\s+/, "").trim() || parsed.streetPart;
  const city = parsed.suburbPart;
  if (!street || (!city && !parsed.postcode)) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("street", street);
  if (city) url.searchParams.set("city", city);
  if (parsed.postcode) url.searchParams.set("postalcode", parsed.postcode);
  if (parsed.state) url.searchParams.set("state", parsed.state);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "ShareHouseManagers/1.0 (info@sharehousemanagers.com.au)",
    },
    cache: "no-store",
  });

  if (!res.ok) return [];
  return (await res.json()) as NominatimItem[];
}

function mergeNominatimResults(...groups: NominatimItem[][]) {
  const seen = new Set<string>();
  const out: NominatimItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = String(item.display_name || JSON.stringify(item.address || {}));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function minQueryLength(q: string) {
  if (/^\d{4}$/.test(q.trim())) return 4;
  if (/^\d+\/\d+$/.test(q.trim())) return 3;
  return 3;
}

export async function GET(request: Request) {
  const q = normalizeAuSearchQuery(new URL(request.url).searchParams.get("q") || "");
  if (q.length < minQueryLength(q)) {
    return NextResponse.json({ suggestions: [] as string[] });
  }

  try {
    const parsed = parseAustralianQuery(q);
    const fragEarly = streetFragmentAfterUnit(parsed);

    if (parsed.unitHouse && parsed.suburbPart && fragEarly && fragEarly.length >= 2) {
      const suburb = titleCaseWords(parsed.suburbPart);
      const frag = fragEarly.toLowerCase();
      const unitSuburbItems = mergeNominatimResults(
        await fetchNominatim(`${titleCaseWords(fragEarly)} Street ${suburb} Australia`),
        await fetchNominatim(`${fragEarly} street ${parsed.suburbPart}`),
        await fetchNominatim(`${fragEarly} ${parsed.suburbPart} Australia`),
      );
      const unitRanked: { line: string; score: number }[] = [];
      const unitSeen = new Set<string>();
      for (const item of unitSuburbItems) {
        const addr = item.address;
        if (!addr?.road) continue;
        const road = String(addr.road).trim();
        const street = `${parsed.unitHouse} ${road}`.trim();
        const locality = formatLocality(
          String(addr?.suburb || addr?.city || parsed.suburbPart).trim(),
          abbrevAuState(String(addr?.state || "")),
          String(addr?.postcode || "").trim(),
        );
        const line = formatProperAuLine(street, locality);
        if (!line || unitSeen.has(line)) continue;
        const lineLower = line.toLowerCase();
        const suburbOk = lineLower.includes(parsed.suburbPart.toLowerCase());
        const fragOk = lineLower.includes(frag) || road.toLowerCase().includes(frag);
        if (
          passesUnitFilter(line, parsed) &&
          suburbOk &&
          fragOk &&
          hasAuLocalityTail(line, parsed) &&
          looksLikeStreetLine(street)
        ) {
          unitSeen.add(line);
          unitRanked.push({ line, score: 200 + suggestionScore(line, parsed) });
        }
      }
      if (unitRanked.length > 0) {
        unitRanked.sort((a, b) => b.score - a.score);
        return NextResponse.json({ suggestions: unitRanked.slice(0, 8).map((r) => r.line) });
      }
    }

    const queries = buildSearchQueries(parsed);
    const primaryQ = buildPrimarySearchQuery(parsed);

    const suburbHint = parsed.suburbPart;

    let data: NominatimItem[] = [];

    if (fragEarly && parsed.suburbPart) {
      const streetSuburbQ = `${titleCaseWords(fragEarly)} Street ${titleCaseWords(parsed.suburbPart)} Australia`;
      data = mergeNominatimResults(data, await fetchNominatim(streetSuburbQ));
    }

    if (data.length < 4) {
      data = mergeNominatimResults(data, await fetchNominatim(primaryQ));
    }

    if (data.length < 6) {
      data = mergeNominatimResults(
        data,
        await fetchPhoton(primaryQ, suburbHint),
        await fetchPhoton(`${parsed.raw} Australia`, suburbHint),
      );
    }

    if (data.length === 0) {
      for (const query of queries.slice(0, 2)) {
        data = mergeNominatimResults(data, await fetchNominatim(query));
        if (data.length >= 8) break;
      }
    }

    const frag = streetFragmentAfterUnit(parsed);
    if (
      data.length === 0 &&
      parsed.unitHouse &&
      frag &&
      frag.length >= 2 &&
      !queries.some((x) => x.toLowerCase().includes(`${frag} street`))
    ) {
      data = mergeNominatimResults(data, await fetchNominatim(`${titleCaseWords(frag)} Street Australia`));
    }

    if (data.length === 0 && parsed.streetPart && (parsed.suburbPart || parsed.postcode) && !parsed.unitHouse) {
      data = mergeNominatimResults(data, await fetchNominatimStructured(parsed));
    }

    if (data.length === 0 && parsed.suburbPart && !parsed.streetPart && !parsed.unitHouse) {
      data = mergeNominatimResults(
        data,
        await fetchNominatim(`${parsed.suburbPart}, Australia`, "street"),
      );
    }

    const seen = new Set<string>();
    const ranked: { line: string; score: number }[] = [];

    const typed = normalizeTypedSuggestion(parsed);
    if (typed && !seen.has(typed)) {
      const typedScore = 1000 + suggestionScore(typed, parsed);
      if (passesStrongFilter(typed, parsed, typedScore)) {
        seen.add(typed);
        ranked.push({ line: typed, score: typedScore });
      }
    }

    for (const item of data) {
      const line = formatAuSuggestion(item, parsed);
      if (!line || seen.has(line)) continue;
      const score = suggestionScore(line, parsed);
      if (!passesStrongFilter(line, parsed, score)) continue;
      seen.add(line);
      ranked.push({ line, score });
    }

    if (
      ranked.length === 0 &&
      parsed.unitHouse &&
      parsed.suburbPart &&
      streetFragmentAfterUnit(parsed)
    ) {
      const frag = streetFragmentAfterUnit(parsed);
      const plainQ = `${titleCaseWords(frag)} Street ${titleCaseWords(parsed.suburbPart)} Australia`;
      const fallbackItems =
        data.length > 0 ? data : await fetchNominatim(plainQ);
      for (const item of fallbackItems) {
        const addr = item.address;
        if (!addr?.road) continue;
        const street = `${parsed.unitHouse} ${String(addr.road).trim()}`.trim();
        const locality = formatLocality(
          String(addr.suburb || addr.city || parsed.suburbPart).trim(),
          abbrevAuState(String(addr.state || "")),
          String(addr.postcode || "").trim(),
        );
        const line = formatProperAuLine(street, locality);
        if (
          line &&
          passesUnitFilter(line, parsed) &&
          matchesAllQueryWords(line, parsed) &&
          hasAuLocalityTail(line, parsed) &&
          looksLikeStreetLine(street) &&
          !isJunkStreetName(street)
        ) {
          ranked.push({ line, score: 100 + suggestionScore(line, parsed) });
        }
      }
    }

    ranked.sort((a, b) => b.score - a.score);
    const suggestions = ranked.slice(0, 8).map((r) => r.line);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] as string[] });
  }
}
