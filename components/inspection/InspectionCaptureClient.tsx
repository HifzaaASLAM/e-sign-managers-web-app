"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, ImageIcon, Images } from "lucide-react";

type Photo = { id: string; fileName: string; url: string };
type Part = {
  id: string;
  label: string;
  tenantNote: string | null;
  photos: Photo[];
};
type Area = {
  id: string;
  label: string;
  tenantNotes: string | null;
  parts: Part[];
};
type InspectionPayload = {
  id: string;
  tenantName: string;
  propertyName: string;
  scheduledAt: string | null;
  status: string;
  areas: Area[];
};

const SCREEN_COUNT = 3;

function splitAreasIntoScreens(areas: Area[], screenCount = SCREEN_COUNT): Area[][] {
  if (areas.length === 0) return [[], [], []].slice(0, screenCount);
  const screens: Area[][] = Array.from({ length: screenCount }, () => []);
  const sizes = Array.from({ length: screenCount }, (_, i) => {
    const base = Math.floor(areas.length / screenCount);
    const rem = areas.length % screenCount;
    return base + (i < rem ? 1 : 0);
  });
  let cursor = 0;
  sizes.forEach((size, index) => {
    screens[index] = areas.slice(cursor, cursor + size);
    cursor += size;
  });
  return screens.filter((group, i) => group.length > 0 || i === 0);
}

function PartModule({
  areaLabel,
  part,
  busy,
  locked,
  onUpload,
  onSaveNote,
}: {
  areaLabel: string;
  part: Part;
  busy: boolean;
  locked: boolean;
  onUpload: (partId: string, files: FileList | null) => Promise<void>;
  onSaveNote: (partId: string, note: string) => Promise<void>;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{areaLabel}</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">{part.label}</h2>
      <p className="mt-1 text-sm text-slate-500">Take a photo now or upload ones you already have.</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => cameraRef.current?.click()}
          className="flex flex-col items-start gap-1 rounded-xl bg-[#0f172a] px-3 py-3.5 text-left text-white disabled:opacity-50"
        >
          <Camera className="h-5 w-5" />
          <span className="text-sm font-semibold">Take photo</span>
          <span className="text-xs text-slate-300">Opens your camera</span>
        </button>
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => galleryRef.current?.click()}
          className="flex flex-col items-start gap-1 rounded-xl border border-slate-300 bg-white px-3 py-3.5 text-left text-slate-900 disabled:opacity-50"
        >
          <Images className="h-5 w-5" />
          <span className="text-sm font-semibold">Upload photos</span>
          <span className="text-xs text-slate-500">From your gallery</span>
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={busy || locked}
        onChange={(e) => {
          void onUpload(part.id, e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="hidden"
        disabled={busy || locked}
        onChange={(e) => {
          void onUpload(part.id, e.target.files);
          e.target.value = "";
        }}
      />

      {part.photos.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {part.photos.map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.url}
              alt={photo.fileName}
              className="h-28 w-full rounded-lg border border-slate-200 object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
          <ImageIcon className="h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-400">No photos yet for this part.</p>
        </div>
      )}

      <label className="mt-4 block text-sm font-medium text-slate-600">
        Notes (optional)
        <textarea
          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
          rows={3}
          placeholder="Anything worth mentioning about this area?"
          defaultValue={part.tenantNote || ""}
          key={`${part.id}-${part.tenantNote || ""}-${part.photos.length}`}
          disabled={locked}
          onBlur={(e) => void onSaveNote(part.id, e.target.value)}
        />
      </label>
    </section>
  );
}

export function InspectionCaptureClient({
  token,
  initial,
  initiallyLocked,
}: {
  token: string;
  initial: InspectionPayload;
  initiallyLocked: boolean;
}) {
  const [inspection, setInspection] = useState(initial);
  const [locked, setLocked] = useState(initiallyLocked);
  const [screenIndex, setScreenIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(initiallyLocked);

  const screens = useMemo(() => splitAreasIntoScreens(inspection.areas, SCREEN_COUNT), [inspection.areas]);
  const totalScreens = Math.max(1, screens.length);
  const safeScreen = Math.min(screenIndex, totalScreens - 1);
  const currentAreas = screens[safeScreen] || [];

  const totalParts = useMemo(
    () => inspection.areas.reduce((sum, area) => sum + area.parts.length, 0),
    [inspection.areas],
  );
  const completedParts = useMemo(
    () => inspection.areas.reduce(
      (sum, area) => sum + area.parts.filter((part) => part.photos.length > 0 || Boolean(part.tenantNote?.trim())).length,
      0,
    ),
    [inspection.areas],
  );
  const progressPct = totalParts > 0 ? Math.max(1, Math.round(((safeScreen + 1) / totalScreens) * 100)) : 0;

  async function refreshInspection() {
    const refresh = await fetch(`/api/inspections/public/${encodeURIComponent(token)}`);
    const refreshed = await refresh.json();
    if (refreshed.ok && refreshed.inspection) {
      setInspection(refreshed.inspection);
      if (typeof refreshed.locked === "boolean") setLocked(refreshed.locked);
    }
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/inspections/public/${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Update failed");
    }
    if (data.inspection) setInspection(data.inspection);
    if (typeof data.locked === "boolean") setLocked(data.locked);
    return data;
  }

  async function saveNote(partId: string, value: string) {
    if (locked) return;
    try {
      await patch({ action: "save_part_note", partId, tenantNote: value });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save note");
    }
  }

  async function uploadFiles(partId: string, files: FileList | null) {
    if (!files?.length || locked) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("partId", partId);
        form.set("file", file);
        const res = await fetch(`/api/inspections/public/${encodeURIComponent(token)}/photos`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || "Upload failed");
        }
      }
      await refreshInspection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitAll() {
    setBusy(true);
    setMessage(null);
    try {
      await patch({ action: "submit" });
      setDone(true);
      setLocked(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    if (safeScreen >= totalScreens - 1) {
      void submitAll();
      return;
    }
    setScreenIndex((v) => Math.min(totalScreens - 1, v + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goPrev() {
    setScreenIndex((v) => Math.max(0, v - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done || locked) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shm-logo.png" alt="ShareHouse Managers" className="mx-auto h-10 w-auto" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Photos submitted</h1>
        <p className="mt-2 text-sm text-slate-600">
          Thank you. Your entry inspection photos for {inspection.propertyName} have been received.
        </p>
      </div>
    );
  }

  const isLastScreen = safeScreen >= totalScreens - 1;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col pb-28">
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shm-logo.png" alt="ShareHouse Managers" className="h-9 w-auto" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Entry inspection</h1>
          <p className="mt-1 text-sm text-slate-600">{inspection.propertyName}</p>
          <p className="text-sm text-slate-400">Tenant: {inspection.tenantName}</p>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
              <span>
                Step {safeScreen + 1} of {totalScreens}
              </span>
              <span className="text-orange-500">{progressPct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-orange-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {completedParts} of {totalParts} parts have photos or notes
            </p>
          </div>
        </section>

        {currentAreas.map((area) => (
          <div key={area.id} className="space-y-3">
            {area.parts.map((part) => (
              <PartModule
                key={part.id}
                areaLabel={area.label}
                part={part}
                busy={busy}
                locked={locked}
                onUpload={uploadFiles}
                onSaveNote={saveNote}
              />
            ))}
          </div>
        ))}

        {message ? (
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{message}</p>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <button
            type="button"
            disabled={busy || safeScreen === 0}
            onClick={goPrev}
            className="rounded-xl border border-slate-300 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-800 disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={goNext}
            className="flex-1 rounded-xl bg-[#0f172a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Please wait…" : isLastScreen ? "Submit inspection" : "Next ›"}
          </button>
        </div>
      </div>
    </div>
  );
}
