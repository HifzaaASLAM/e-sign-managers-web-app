"use client";

import { useRef, useState, type DragEvent, type PointerEvent, type RefObject } from "react";

export type CreatorSignatureMode = "draw" | "upload";

function initSignatureCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function getSignatureDataUrlFromCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return "";
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let hasInk = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
      hasInk = true;
      break;
    }
  }
  if (!hasInk) return "";
  return canvas.toDataURL("image/png");
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const type = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    const ok =
      type.startsWith("image/") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".gif") ||
      name.endsWith(".webp");
    if (!ok) {
      reject(new Error("Please upload an image file (PNG, JPG, GIF, or WebP)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function paintDataUrlOnCanvas(canvas: HTMLCanvasElement, dataUrl: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  };
  img.src = dataUrl;
}

export function getCreatorSignatureValue(
  mode: CreatorSignatureMode,
  uploadedDataUrl: string | null,
  canvas: HTMLCanvasElement | null,
) {
  if (mode === "upload" && uploadedDataUrl) return uploadedDataUrl;
  return getSignatureDataUrlFromCanvas(canvas);
}

type CreatorSignatureCaptureProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mode: CreatorSignatureMode;
  onModeChange: (mode: CreatorSignatureMode) => void;
  uploadedDataUrl: string | null;
  onUploadedDataUrlChange: (value: string | null) => void;
  onInitDraw?: () => void;
};

export function CreatorSignatureCapture({
  canvasRef,
  mode,
  onModeChange,
  uploadedDataUrl,
  onUploadedDataUrlChange,
  onInitDraw,
}: CreatorSignatureCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");

  function pointerPos(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function clearAll() {
    initSignatureCanvas(canvasRef.current);
    onUploadedDataUrlChange(null);
    setUploadError("");
    onModeChange("draw");
    onInitDraw?.();
  }

  async function acceptImageFile(file: File | undefined | null) {
    if (!file) return;
    setUploadError("");
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      onUploadedDataUrlChange(dataUrl);
      onModeChange("upload");
      if (canvasRef.current) paintDataUrlOnCanvas(canvasRef.current, dataUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not use image.");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    void acceptImageFile(file);
  }

  return (
    <div className="mt-1">
      <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
        <button
          type="button"
          onClick={() => {
            onModeChange("draw");
            onInitDraw?.();
          }}
          className={`rounded-md px-3 py-1.5 font-semibold ${
            mode === "draw" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => onModeChange("upload")}
          className={`rounded-md px-3 py-1.5 font-semibold ${
            mode === "upload" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Upload image
        </button>
      </div>

      {mode === "draw" ? (
        <canvas
          ref={canvasRef}
          width={560}
          height={140}
          className="w-full max-w-xl cursor-crosshair touch-none rounded-lg border border-slate-300 bg-white"
          onPointerDown={(e) => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (!canvas || !ctx) return;
            onUploadedDataUrlChange(null);
            drawingRef.current = true;
            canvas.setPointerCapture(e.pointerId);
            const p = pointerPos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return;
            const ctx = canvasRef.current?.getContext("2d");
            if (!ctx) return;
            const p = pointerPos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          onPointerLeave={() => {
            drawingRef.current = false;
          }}
        />
      ) : (
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={onDrop}
          className={`max-w-xl rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver ? "border-[#f47a21] bg-orange-50" : "border-slate-300 bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
            className="hidden"
            onChange={(e) => void acceptImageFile(e.target.files?.[0])}
          />
          {uploadedDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadedDataUrl}
                alt="Uploaded signature preview"
                className="max-h-28 max-w-full rounded border border-slate-200 bg-white object-contain p-2"
              />
              <p className="text-xs text-emerald-700 font-medium">Signature image ready</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold text-[#d96512] hover:underline"
              >
                Replace image
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">Drag and drop your signature image here</p>
              <p className="mt-1 text-xs text-slate-500">PNG, JPG, GIF, or WebP</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Choose file
              </button>
            </>
          )}
        </div>
      )}

      {uploadError ? <p className="mt-2 text-xs text-red-700">{uploadError}</p> : null}

      <div className="mt-2 flex justify-end">
        <button type="button" onClick={clearAll} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
          Clear
        </button>
      </div>
    </div>
  );
}

export { initSignatureCanvas };
