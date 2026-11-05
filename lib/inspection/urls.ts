import { createToken, getAppUrl } from "../shm/documents";

export function createInspectionToken() {
  return createToken();
}

export function getInspectionCaptureUrl(captureToken: string) {
  return `${getAppUrl()}/inspect/${encodeURIComponent(captureToken)}`;
}

export function getInspectionReportUrl(reportToken: string) {
  return `${getAppUrl()}/inspect/report/${encodeURIComponent(reportToken)}`;
}

export function getInspectionPhotoUrl(photoId: string, opts?: { token?: string; admin?: boolean }) {
  const url = new URL(`/api/inspections/photos/${encodeURIComponent(photoId)}`, getAppUrl());
  if (opts?.token) url.searchParams.set("token", opts.token);
  if (opts?.admin) url.searchParams.set("admin", "1");
  return url.pathname + url.search;
}
