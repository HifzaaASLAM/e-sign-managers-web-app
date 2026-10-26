/**
 * Optional DOCX → PDF via PDFShift (same env as ownership statements).
 */
export async function convertDocxBufferToPdf(docx: Buffer, fileName = "tenant-agreement.docx"): Promise<Buffer | null> {
  const apiKey = process.env.PDF_API_KEY?.trim();
  const apiUrl = process.env.PDF_API_URL?.trim() || "https://api.pdfshift.io/v3/convert/pdf";
  if (!apiKey || !docx.length) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      },
      body: JSON.stringify({
        source: docx.toString("base64"),
        filename: fileName.endsWith(".docx") ? fileName : `${fileName}.docx`,
        sandbox: false,
        use_print: true,
        format: "A4",
        margin: "12mm",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[docx-to-pdf] PDFShift failed", response.status, text.slice(0, 400));
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const out = Buffer.from(arrayBuffer);
    return out.length ? out : null;
  } catch (error) {
    console.error("[docx-to-pdf]", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
