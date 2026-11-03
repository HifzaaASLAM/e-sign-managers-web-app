import { getAppUrl } from "./documents";

export function scheduleBackgroundWork(promise: Promise<unknown>) {
  void promise.catch((error) => {
    console.error("[background-work]", error);
  });
}

function resolveInternalJobSecret() {
  return (
    process.env.INTERNAL_JOB_SECRET?.trim() ||
    process.env.MAKE_CALLBACK_SECRET?.trim() ||
    ""
  );
}

async function runOwnershipStatementSendJob(documentId: string, jobId: string) {
  const { processOwnershipStatementSendJob } = await import("./ownership-statement-send-processor");
  await processOwnershipStatementSendJob(documentId, jobId);
}

export function dispatchOwnershipStatementSendJob(documentId: string, jobId: string) {
  dispatchShmSendJob("/api/shm-docs/ownership-statement/process-send", runOwnershipStatementSendJob, documentId, jobId);
}

async function runTenantApplicationAutoApproveJob(documentId: string, jobId: string) {
  const { processTenantApplicationAutoApprove } = await import("./tenant-application-auto-approve");
  await processTenantApplicationAutoApprove(documentId, jobId);
}

async function runTenantAgreementAutoCreatorSignJob(documentId: string, jobId: string) {
  const { processTenantAgreementAutoCreatorSign } = await import("./tenant-agreement-auto-creator-sign");
  await processTenantAgreementAutoCreatorSign(documentId, jobId);
}

async function runPmaAutoCreatorSignJob(documentId: string, jobId: string) {
  const { processPmaAutoCreatorSign } = await import("./property-management-agreement-auto-creator-sign");
  await processPmaAutoCreatorSign(documentId, jobId);
}

export function dispatchPmaAutoCreatorSignJob(documentId: string, jobId: string) {
  const secret = resolveInternalJobSecret();

  const runWhenDue = async () => {
    const { resolvePmaAutoCreatorSignDelayMs, processPmaAutoCreatorSign } = await import(
      "./property-management-agreement-auto-creator-sign"
    );
    const delayMs = resolvePmaAutoCreatorSignDelayMs();
    const started = Date.now();
    const deadline = started + delayMs + 15_000;

    while (Date.now() < deadline) {
      const remaining = delayMs - (Date.now() - started);
      if (remaining > 0) {
        const slice = Math.min(remaining, 20_000);
        await new Promise<void>((resolve) => setTimeout(resolve, slice));
        continue;
      }

      if (secret) {
        const workerUrl = new URL("/api/shm-docs/property-management-agreement/process-auto-creator-sign", getAppUrl()).toString();
        try {
          const response = await fetch(workerUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-job-secret": secret,
            },
            body: JSON.stringify({ documentId, jobId }),
          });
          if (response.ok || response.status === 200 || response.status === 202) return;
          if (response.status === 425) continue;
        } catch {
          // fall through to in-process run
        }
      }

      const result = await processPmaAutoCreatorSign(documentId, jobId);
      if (result.status === 425) continue;
      return;
    }

    await runPmaAutoCreatorSignJob(documentId, jobId);
  };

  scheduleBackgroundWork(runWhenDue());

  if (secret) {
    const pendingUrl = new URL("/api/shm-docs/property-management-agreement/run-pending-auto-creator-sign", getAppUrl()).toString();
    const kickPending = async () => {
      const delayMs = (await import("./property-management-agreement-auto-creator-sign")).resolvePmaAutoCreatorSignDelayMs();
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(5_000, delayMs + 2_000)));
      try {
        await fetch(pendingUrl, {
          method: "POST",
          headers: { "x-internal-job-secret": secret },
        });
      } catch {
        // ignore
      }
    };
    scheduleBackgroundWork(kickPending());
  }
}

export function dispatchTenantAgreementAutoCreatorSignJob(documentId: string, jobId: string) {
  const secret = resolveInternalJobSecret();

  const runWhenDue = async () => {
    const { resolveTenantAgreementAutoCreatorSignDelayMs, processTenantAgreementAutoCreatorSign } = await import(
      "./tenant-agreement-auto-creator-sign"
    );
    const delayMs = resolveTenantAgreementAutoCreatorSignDelayMs();
    const started = Date.now();
    const deadline = started + delayMs + 15_000;

    while (Date.now() < deadline) {
      const remaining = delayMs - (Date.now() - started);
      if (remaining > 0) {
        const slice = Math.min(remaining, 20_000);
        await new Promise<void>((resolve) => setTimeout(resolve, slice));
        continue;
      }

      if (secret) {
        const workerUrl = new URL("/api/shm-docs/tenant-agreement/process-auto-creator-sign", getAppUrl()).toString();
        try {
          const response = await fetch(workerUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-job-secret": secret,
            },
            body: JSON.stringify({ documentId, jobId }),
          });
          if (response.ok || response.status === 200 || response.status === 202) return;
          if (response.status === 425) continue;
        } catch {
          // fall through to in-process run
        }
      }

      const result = await processTenantAgreementAutoCreatorSign(documentId, jobId);
      if (result.status === 425) continue;
      return;
    }

    await runTenantAgreementAutoCreatorSignJob(documentId, jobId);
  };

  scheduleBackgroundWork(runWhenDue());

  if (secret) {
    const pendingUrl = new URL("/api/shm-docs/tenant-agreement/run-pending-auto-creator-sign", getAppUrl()).toString();
    const kickPending = async () => {
      const delayMs = (await import("./tenant-agreement-auto-creator-sign")).resolveTenantAgreementAutoCreatorSignDelayMs();
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(5_000, delayMs + 2_000)));
      try {
        await fetch(pendingUrl, {
          method: "POST",
          headers: { "x-internal-job-secret": secret },
        });
      } catch {
        // ignore — Hostinger cron can still catch it
      }
    };
    scheduleBackgroundWork(kickPending());
  }
}

export function dispatchTenantApplicationAutoApproveJob(documentId: string, jobId: string) {
  const secret = resolveInternalJobSecret();

  const runWhenDue = async () => {
    const { resolveTenantApplicationAutoApproveDelayMs, processTenantApplicationAutoApprove } = await import(
      "./tenant-application-auto-approve"
    );
    const delayMs = resolveTenantApplicationAutoApproveDelayMs();
    const started = Date.now();
    const deadline = started + delayMs + 15_000;

    // Hostinger / shared hosts often kill idle work. Poll in short slices and
    // also self-call the HTTP worker so the job survives across requests.
    while (Date.now() < deadline) {
      const remaining = delayMs - (Date.now() - started);
      if (remaining > 0) {
        const slice = Math.min(remaining, 20_000);
        await new Promise<void>((resolve) => setTimeout(resolve, slice));
        continue;
      }

      if (secret) {
        const workerUrl = new URL("/api/shm-docs/tenant-application/process-auto-approve", getAppUrl()).toString();
        try {
          const response = await fetch(workerUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-job-secret": secret,
            },
            body: JSON.stringify({ documentId, jobId }),
          });
          if (response.ok || response.status === 200 || response.status === 202 || response.status === 409) {
            return;
          }
          // 425 = not due yet — keep waiting
          if (response.status === 425) continue;
        } catch {
          // fall through to in-process run only when the worker request did not complete
        }
      }

      const result = await processTenantApplicationAutoApprove(documentId, jobId);
      if (result.status === 425) continue;
      if (result.status === 200 || result.status === 202 || result.status === 409) return;
    }

    // Final attempt after deadline window.
    await runTenantApplicationAutoApproveJob(documentId, jobId);
  };

  scheduleBackgroundWork(runWhenDue());

  // Extra safety: ask the pending runner to pick this up if the delayed worker dies.
  if (secret) {
    const pendingUrl = new URL("/api/shm-docs/tenant-application/run-pending-auto-approve", getAppUrl()).toString();
    const kickPending = async () => {
      const delayMs = (await import("./tenant-application-auto-approve")).resolveTenantApplicationAutoApproveDelayMs();
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(5_000, delayMs + 2_000)));
      try {
        await fetch(pendingUrl, {
          method: "POST",
          headers: { "x-internal-job-secret": secret },
        });
      } catch {
        // ignore — cron / landlord page can still catch it
      }
    };
    scheduleBackgroundWork(kickPending());
  }
}

function dispatchShmSendJob(
  path: string,
  fallback: (documentId: string, jobId: string) => Promise<void>,
  documentId: string,
  jobId: string,
) {
  const secret = resolveInternalJobSecret();

  if (!secret) {
    scheduleBackgroundWork(fallback(documentId, jobId));
    return;
  }

  const workerUrl = new URL(path, getAppUrl()).toString();

  const dispatch = fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-job-secret": secret,
    },
    body: JSON.stringify({ documentId, jobId }),
  }).then(async (response) => {
    if (!response.ok) {
      await fallback(documentId, jobId);
    }
  }).catch(async () => {
    await fallback(documentId, jobId);
  });

  scheduleBackgroundWork(dispatch);
}

export function isValidInternalJobSecret(request: Request) {
  const expected = resolveInternalJobSecret();
  if (!expected) return true;
  const provided = request.headers.get("x-internal-job-secret")?.trim() || "";
  return provided === expected;
}
