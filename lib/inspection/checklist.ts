export type ChecklistPartDef = {
  partKey: string;
  label: string;
};

export type ChecklistAreaDef = {
  areaKey: string;
  label: string;
  parts: ChecklistPartDef[];
};

export const STANDARD_PARTS: ChecklistPartDef[] = [
  { partKey: "walls", label: "Walls" },
  { partKey: "ceiling", label: "Ceiling" },
  { partKey: "floor", label: "Floor" },
  { partKey: "windows", label: "Windows" },
  { partKey: "doors", label: "Doors" },
  { partKey: "fixtures", label: "Fixtures" },
  { partKey: "fittings", label: "Fittings" },
];

const FIXED_AREAS: Array<{ areaKey: string; label: string }> = [
  { areaKey: "exterior", label: "Exterior" },
  { areaKey: "entry_hall", label: "Entry / Hall" },
  { areaKey: "living", label: "Living" },
  { areaKey: "kitchen", label: "Kitchen" },
  { areaKey: "dining", label: "Dining" },
  { areaKey: "laundry", label: "Laundry" },
  { areaKey: "garage_carport", label: "Garage / Carport" },
  { areaKey: "outdoor_garden", label: "Outdoor / Garden" },
];

export function buildEntryChecklist(input: {
  bathroomCount?: number;
  bedroomCount?: number;
}): ChecklistAreaDef[] {
  const bathroomCount = Math.min(Math.max(Number(input.bathroomCount) || 1, 1), 6);
  const bedroomCount = Math.min(Math.max(Number(input.bedroomCount) || 1, 1), 8);

  const areas: ChecklistAreaDef[] = [];

  for (const area of FIXED_AREAS.slice(0, 5)) {
    areas.push({ ...area, parts: STANDARD_PARTS });
  }

  for (let i = 1; i <= bathroomCount; i += 1) {
    areas.push({
      areaKey: bathroomCount === 1 ? "bathroom" : `bathroom_${i}`,
      label: bathroomCount === 1 ? "Bathroom" : `Bathroom ${i}`,
      parts: STANDARD_PARTS,
    });
  }

  for (let i = 1; i <= bedroomCount; i += 1) {
    areas.push({
      areaKey: bedroomCount === 1 ? "bedroom" : `bedroom_${i}`,
      label: bedroomCount === 1 ? "Bedroom" : `Bedroom ${i}`,
      parts: STANDARD_PARTS,
    });
  }

  for (const area of FIXED_AREAS.slice(5)) {
    areas.push({ ...area, parts: STANDARD_PARTS });
  }

  return areas;
}
