export type RecipientEmailDelivery = {
  label: string;
  tone: "ok" | "warn" | "error" | "muted";
  detail?: string;
};

export function describeRecipientEmailDelivery(input: {
  recipientStatus: string;
  creatorSigned: boolean;
  recipientSigned: boolean;
  sentAt: Date | null;
  lastSigningEmailStatus?: string | null;
  lastSigningEmailError?: string | null;
}): RecipientEmailDelivery {
  if (input.recipientSigned) {
    return { label: "Recipient signed", tone: "ok" };
  }

  const status = input.recipientStatus.trim();
  if (status === "Email failed") {
    return {
      label: "Signing email failed",
      tone: "error",
      detail: input.lastSigningEmailError || "Resend rejected or could not send. Use Re-send or share the direct link.",
    };
  }

  if (status === "Sent") {
    return {
      label: "Signing email sent",
      tone: "ok",
      detail: input.lastSigningEmailStatus === "error"
        ? input.lastSigningEmailError || "Latest log shows an error — try Re-send."
        : undefined,
    };
  }

  if (input.sentAt && status !== "Not Sent") {
    return {
      label: "Signing email sent",
      tone: "ok",
    };
  }

  if (input.creatorSigned) {
    return {
      label: "Signing email not sent yet",
      tone: "warn",
      detail:
        input.lastSigningEmailStatus === "skipped"
          ? input.lastSigningEmailError || "Email is not configured (RESEND_API_KEY / EMAIL_FROM)."
          : input.lastSigningEmailStatus === "error"
            ? input.lastSigningEmailError || "The last send attempt failed. Use Re-send on the document page."
            : "Use Re-send contract on the document page, or copy the direct signing link to the tenant.",
    };
  }

  return { label: "Not sent", tone: "muted" };
}

export async function loadLatestSigningEmailLog(prisma: {
  emailLog: {
    findMany: (args: {
      where: { type: string };
      orderBy: { createdAt: "desc" };
      take: number;
    }) => Promise<Array<{ status: string; metadata: string | null; to: string }>>;
  };
}, documentId: string, recipientEmail?: string | null) {
  const needle = documentId.trim();
  const email = String(recipientEmail || "").trim().toLowerCase();
  const rows = await prisma.emailLog.findMany({
    where: {
      type: "shm_signing_link",
      metadata: { contains: needle },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  for (const row of rows) {
    if (email && row.to.trim().toLowerCase() !== email) continue;
    let error: string | undefined;
    try {
      const meta = JSON.parse(row.metadata) as { error?: string; reason?: string };
      error = meta.error || meta.reason;
    } catch {
      // ignore
    }
    return { status: row.status, error };
  }
  return null;
}
