import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import { getWorkspaceByEmail } from "../workspace";
import { prisma } from "../prisma";

export async function requireInspectionWorkspace() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: "Unauthorized" as const, status: 401 as const };
  }
  const { company, user } = await getWorkspaceByEmail(session.user.email);
  if (!company?.id) {
    return { error: "No workspace" as const, status: 403 as const };
  }
  return {
    companyId: company.id,
    userId: user?.id ?? null,
    email: session.user.email,
  };
}

export async function requireCompanyInspection(inspectionId: string, companyId: string) {
  return prisma.inspection.findFirst({
    where: { id: inspectionId, companyId },
    include: {
      areas: {
        orderBy: { sortOrder: "asc" },
        include: {
          parts: {
            orderBy: { sortOrder: "asc" },
            include: {
              photos: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      signatures: { orderBy: { signedAt: "asc" } },
    },
  });
}

export async function findInspectionByCaptureToken(token: string) {
  return prisma.inspection.findUnique({
    where: { captureToken: token },
    include: {
      areas: {
        orderBy: { sortOrder: "asc" },
        include: {
          parts: {
            orderBy: { sortOrder: "asc" },
            include: {
              photos: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      signatures: { orderBy: { signedAt: "asc" } },
    },
  });
}

export async function findInspectionByReportToken(token: string) {
  return prisma.inspection.findUnique({
    where: { reportToken: token },
    include: {
      areas: {
        orderBy: { sortOrder: "asc" },
        include: {
          parts: {
            orderBy: { sortOrder: "asc" },
            include: {
              photos: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      signatures: { orderBy: { signedAt: "asc" } },
    },
  });
}
