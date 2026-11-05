import { prisma } from "../prisma";
import { buildEntryChecklist } from "./checklist";
import { createInspectionToken, getInspectionCaptureUrl, getInspectionReportUrl } from "./urls";
import type { Inspection, InspectionArea, InspectionPart, InspectionPhoto, InspectionSignature } from "@prisma/client";

export type InspectionFull = Inspection & {
  areas: Array<
    InspectionArea & {
      parts: Array<InspectionPart & { photos: InspectionPhoto[] }>;
    }
  >;
  signatures: InspectionSignature[];
};

export function serializeInspection(
  inspection: InspectionFull,
  opts?: { includeTokens?: boolean; photoToken?: string },
) {
  const captureUrl = getInspectionCaptureUrl(inspection.captureToken);
  const reportUrl = inspection.reportToken ? getInspectionReportUrl(inspection.reportToken) : null;
  const photoQuery = opts?.photoToken
    ? `?token=${encodeURIComponent(opts.photoToken)}`
    : "?admin=1";

  return {
    id: inspection.id,
    type: inspection.type,
    status: inspection.status,
    tenantName: inspection.tenantName,
    propertyName: inspection.propertyName,
    scheduledAt: inspection.scheduledAt?.toISOString() ?? null,
    bathroomCount: inspection.bathroomCount,
    bedroomCount: inspection.bedroomCount,
    inviteName: inspection.inviteName,
    inviteEmail: inspection.inviteEmail,
    submittedAt: inspection.submittedAt?.toISOString() ?? null,
    completedAt: inspection.completedAt?.toISOString() ?? null,
    createdAt: inspection.createdAt.toISOString(),
    updatedAt: inspection.updatedAt.toISOString(),
    captureUrl: opts?.includeTokens === false ? null : captureUrl,
    reportUrl: opts?.includeTokens === false ? null : reportUrl,
    areas: inspection.areas.map((area) => ({
      id: area.id,
      areaKey: area.areaKey,
      label: area.label,
      sortOrder: area.sortOrder,
      tenantNotes: area.tenantNotes,
      parts: area.parts.map((part) => ({
        id: part.id,
        partKey: part.partKey,
        label: part.label,
        sortOrder: part.sortOrder,
        tenantNote: part.tenantNote,
        adminComment: part.adminComment,
        photos: part.photos.map((photo) => ({
          id: photo.id,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
          sortOrder: photo.sortOrder,
          url: `/api/inspections/photos/${photo.id}${photoQuery}`,
        })),
      })),
    })),
    signatures: inspection.signatures.map((sig) => ({
      id: sig.id,
      role: sig.role,
      name: sig.name,
      imageDataUrl: sig.imageDataUrl,
      signedAt: sig.signedAt.toISOString(),
    })),
  };
}

export async function createEntryInspection(input: {
  companyId: string;
  createdById?: string | null;
  tenantName: string;
  propertyName: string;
  scheduledAt?: string | null;
  bathroomCount?: number;
  bedroomCount?: number;
  inviteName?: string | null;
  inviteEmail?: string | null;
}) {
  const tenantName = input.tenantName.trim();
  const propertyName = input.propertyName.trim();
  if (!tenantName || !propertyName) {
    throw new Error("Tenant name and property name are required.");
  }

  const bathroomCount = Math.min(Math.max(Number(input.bathroomCount) || 1, 1), 6);
  const bedroomCount = Math.min(Math.max(Number(input.bedroomCount) || 1, 1), 8);
  const checklist = buildEntryChecklist({ bathroomCount, bedroomCount });
  const captureToken = createInspectionToken();
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

  const inspection = await prisma.inspection.create({
    data: {
      companyId: input.companyId,
      createdById: input.createdById || null,
      type: "ENTRY",
      status: "AWAITING_CAPTURE",
      tenantName,
      propertyName,
      scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
      bathroomCount,
      bedroomCount,
      captureToken,
      inviteName: input.inviteName?.trim() || null,
      inviteEmail: input.inviteEmail?.trim().toLowerCase() || null,
      areas: {
        create: checklist.map((area, areaIndex) => ({
          areaKey: area.areaKey,
          label: area.label,
          sortOrder: areaIndex,
          parts: {
            create: area.parts.map((part, partIndex) => ({
              partKey: part.partKey,
              label: part.label,
              sortOrder: partIndex,
            })),
          },
        })),
      },
    },
    include: {
      areas: {
        orderBy: { sortOrder: "asc" },
        include: {
          parts: {
            orderBy: { sortOrder: "asc" },
            include: { photos: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
      signatures: true,
    },
  });

  return inspection;
}

export function listStatusLabel(status: string) {
  switch (status) {
    case "AWAITING_CAPTURE":
      return "Awaiting photos";
    case "SUBMITTED":
      return "Submitted";
    case "IN_REVIEW":
      return "In review";
    case "COMPLETED":
      return "Completed";
    case "DRAFT":
      return "Draft";
    default:
      return status;
  }
}
