export const DEMO_IMAGE_WIDTH = 96;
export const DEMO_IMAGE_HEIGHT = 34;

// Fixed, self-contained projection of the supplied FIPS banner. Keeping it in
// the bundle makes both offline demo nodes display the same payload.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="298" height="106" viewBox="0 0 298 106">
<rect width="298" height="106" fill="#0d1118"/><path d="M22 48L97 20M97 20L288 95M208 58L288 95" stroke="#12303a" stroke-width="2"/>
<circle cx="97" cy="20" r="12" fill="#12333a"/><circle cx="288" cy="101" r="12" fill="#12606b"/>
<rect x="23" y="24" width="60" height="61" fill="#03131d"/><circle cx="53" cy="50" r="14" fill="#16424b"/>
<path d="M53 34v31M38 50h30M43 39l21 23M63 39L42 62M47 36l12 29M59 36L47 65" stroke="#72c9c4" stroke-width="1" opacity=".9"/>
<text x="42" y="75" fill="#d7f8f0" font-family="monospace" font-size="6">FIPS</text><text x="39" y="80" fill="#8eb4ba" font-family="monospace" font-size="4">fips.network</text>
<text x="103" y="58" fill="#43ad70" font-family="monospace" font-weight="700" font-size="42">FIPS</text>
<text x="103" y="82" fill="#777491" font-family="monospace" font-size="20">fips.network</text></svg>`;

export const DEMO_IMAGE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export interface ImageBand {
  readonly y: number;
  readonly rows: number;
  readonly rgbaBase64: string;
}

export interface ImageTransferSnapshot {
  readonly transferId: string | null;
  readonly width: number;
  readonly height: number;
  readonly receivedRows: number;
  readonly complete: boolean;
  readonly revision: number;
  readonly bands: readonly ImageBand[];
}

export async function demoImageRaster(): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.src = DEMO_IMAGE_DATA_URL;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = DEMO_IMAGE_WIDTH; canvas.height = DEMO_IMAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('image_canvas_unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function decodeBand(value: string): Uint8ClampedArray<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
