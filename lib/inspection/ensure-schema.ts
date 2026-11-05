import { prisma } from "../prisma";

let ensurePromise: Promise<void> | null = null;

async function runEnsure() {
  // Works over Prisma query engine (pooler-safe) when schema engine / db push hangs.
  await prisma.$executeRawUnsafe(`
DO $$ BEGIN
  CREATE TYPE "InspectionType" AS ENUM ('ENTRY', 'ROUTINE', 'EXIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
  await prisma.$executeRawUnsafe(`
DO $$ BEGIN
  CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'AWAITING_CAPTURE', 'SUBMITTED', 'IN_REVIEW', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
  await prisma.$executeRawUnsafe(`
DO $$ BEGIN
  CREATE TYPE "InspectionSignatureRole" AS ENUM ('TENANT', 'AGENT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "Inspection" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "createdById" TEXT,
  "type" "InspectionType" NOT NULL DEFAULT 'ENTRY',
  "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
  "tenantName" TEXT NOT NULL,
  "propertyName" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "bathroomCount" INTEGER NOT NULL DEFAULT 1,
  "bedroomCount" INTEGER NOT NULL DEFAULT 1,
  "captureToken" TEXT NOT NULL,
  "reportToken" TEXT,
  "inviteName" TEXT,
  "inviteEmail" TEXT,
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Inspection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`);

  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Inspection_captureToken_key" ON "Inspection"("captureToken");`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Inspection_reportToken_key" ON "Inspection"("reportToken");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Inspection_companyId_idx" ON "Inspection"("companyId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Inspection_companyId_createdAt_idx" ON "Inspection"("companyId", "createdAt" DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Inspection_status_idx" ON "Inspection"("status");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Inspection_type_idx" ON "Inspection"("type");`);

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "InspectionArea" (
  "id" TEXT PRIMARY KEY,
  "inspectionId" TEXT NOT NULL,
  "areaKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tenantNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionArea_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionArea_inspectionId_idx" ON "InspectionArea"("inspectionId");`);

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "InspectionPart" (
  "id" TEXT PRIMARY KEY,
  "areaId" TEXT NOT NULL,
  "partKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "tenantNote" TEXT,
  "adminComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionPart_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "InspectionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionPart_areaId_idx" ON "InspectionPart"("areaId");`);

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "InspectionPhoto" (
  "id" TEXT PRIMARY KEY,
  "partId" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "dataBase64" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionPhoto_partId_fkey" FOREIGN KEY ("partId") REFERENCES "InspectionPart"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionPhoto" ADD COLUMN IF NOT EXISTS "dataBase64" TEXT;`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionPhoto_partId_idx" ON "InspectionPhoto"("partId");`);

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "InspectionSignature" (
  "id" TEXT PRIMARY KEY,
  "inspectionId" TEXT NOT NULL,
  "role" "InspectionSignatureRole" NOT NULL,
  "name" TEXT NOT NULL,
  "imageDataUrl" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionSignature_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionSignature_inspectionId_idx" ON "InspectionSignature"("inspectionId");`);
}

export async function ensureInspectionSchema() {
  if (!ensurePromise) {
    ensurePromise = runEnsure().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
