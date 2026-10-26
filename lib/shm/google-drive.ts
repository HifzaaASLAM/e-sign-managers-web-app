import crypto from "crypto";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

type DriveCredentials = { clientEmail: string; privateKey: string };

function getDriveCredentials(): DriveCredentials | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return { clientEmail: parsed.client_email, privateKey: parsed.private_key };
      }
    } catch {
      // fall through to individual env vars
    }
  }
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  // Private keys pasted into .env files usually have literal \n sequences.
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (clientEmail && privateKey) return { clientEmail, privateKey };
  return null;
}

export function isDriveDirectUploadConfigured() {
  return Boolean(getDriveCredentials());
}

/** Production SHM DATA parent folder (shared Drive). Env vars always win when set. */
const DEFAULT_SHM_DRIVE_PARENT_FOLDER_ID = "144Gm-Q0g5vdViREaIz8hVGsQtZzdnal-";

export function getDriveParentFolderId() {
  return process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim()
    || process.env.MAKE_DRIVE_PARENT_FOLDER_ID?.trim()
    || DEFAULT_SHM_DRIVE_PARENT_FOLDER_ID;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const creds = getDriveCredentials();
  if (!creds) throw new Error("Google Drive service account is not configured.");

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: creds.clientEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(creds.privateKey);
  const assertion = `${header}.${claims}.${base64Url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok || !json.access_token) {
    throw new Error(`Google Drive auth failed (${response.status}): ${json.error_description || json.error || "unknown error"}`);
  }
  cachedToken = { token: json.access_token, expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function driveFolderUrl(folderId: string) {
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : "";
}

export function driveFileUrl(fileId: string) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : "";
}

/** Find a folder by name (optionally under a parent) or create it. Returns its id and web URL. */
export async function ensureDriveFolder(name: string, parentId?: string) {
  const token = await getAccessToken();
  const qParts = [
    `name = '${escapeDriveQueryValue(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ];
  if (parentId) qParts.push(`'${escapeDriveQueryValue(parentId)}' in parents`);

  const searchUrl = new URL(DRIVE_FILES_URL);
  searchUrl.searchParams.set("q", qParts.join(" and "));
  searchUrl.searchParams.set("fields", "files(id,webViewLink)");
  searchUrl.searchParams.set("pageSize", "1");
  searchUrl.searchParams.set("supportsAllDrives", "true");
  searchUrl.searchParams.set("includeItemsFromAllDrives", "true");

  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (searchRes.ok) {
    const searchJson = (await searchRes.json().catch(() => ({}))) as { files?: Array<{ id?: string; webViewLink?: string }> };
    const existing = searchJson.files?.[0];
    if (existing?.id) {
      return { id: existing.id, url: existing.webViewLink || driveFolderUrl(existing.id) };
    }
  }

  const createRes = await fetch(`${DRIVE_FILES_URL}?supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!createRes.ok || !createJson.id) {
    throw new Error(`Could not create Drive folder "${name}" (${createRes.status}): ${createJson.error?.message || "unknown error"}`);
  }
  return { id: createJson.id, url: createJson.webViewLink || driveFolderUrl(createJson.id) };
}

/** Upload a file into a Drive folder using a resumable session (works for any file size). */
export async function uploadFileToDriveFolder(input: {
  name: string;
  mimeType: string;
  buffer: Buffer;
  folderId: string;
}) {
  const token = await getAccessToken();

  const initRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.buffer.length),
    },
    body: JSON.stringify({ name: input.name, parents: [input.folderId] }),
  });
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => "");
    throw new Error(`Could not start Drive upload for "${input.name}" (${initRes.status}): ${text.slice(0, 300)}`);
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) {
    throw new Error(`Drive did not return an upload session for "${input.name}".`);
  }

  const uploadRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": input.mimeType },
    body: new Uint8Array(input.buffer),
  });
  const uploadJson = (await uploadRes.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!uploadRes.ok || !uploadJson.id) {
    throw new Error(`Drive upload failed for "${input.name}" (${uploadRes.status}): ${uploadJson.error?.message || "unknown error"}`);
  }
  return { id: uploadJson.id, url: uploadJson.webViewLink || driveFileUrl(uploadJson.id) };
}
