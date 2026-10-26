import { prisma } from "../prisma";

let ensurePromise: Promise<void> | null = null;

/** Creates the Templates table if it does not exist yet (Hostinger-safe). */
export async function ensureTenantAgreementTemplateTable() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ShmTenantAgreementTemplate" (
          "id" TEXT NOT NULL,
          "companyId" TEXT NOT NULL,
          "createdById" TEXT,
          "name" TEXT NOT NULL,
          "description" TEXT,
          "agreementData" TEXT NOT NULL,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "ShmTenantAgreementTemplate_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ShmTenantAgreementTemplate_companyId_idx"
        ON "ShmTenantAgreementTemplate"("companyId")
      `);
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

export function templateApiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  const missingTable =
    /ShmTenantAgreementTemplate/i.test(message) &&
    /(does not exist|P2021|relation|table)/i.test(message);
  return {
    ok: false as const,
    message: missingTable
      ? "Templates database table is missing. Redeploy the latest app (it will create the table automatically), or run prisma/migrations/manual_shm_tenant_agreement_template.sql."
      : fallback,
    details: process.env.NODE_ENV === "development" ? message : undefined,
  };
}
