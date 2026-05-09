import { saveAs } from "file-saver";
import { PLATFORM_NAME, PLATFORM_VERSION } from "./content";

import pdfAssetUrl from "@assets/image_1778352657621.png";

export async function generatePdf(onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.("Preparing PDF download…");
  const response = await fetch(pdfAssetUrl);
  if (!response.ok) {
    throw new Error("PDF file could not be loaded");
  }
  const blob = await response.blob();
  saveAs(blob, `${PLATFORM_NAME.replace(/\s+/g, "-")}-Documentation-v${PLATFORM_VERSION}.pdf`);
  onProgress?.("Done");
}
