import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import JSZip from "jszip";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { objectStorageClient } from "./objectStorage";

const _require = createRequire(import.meta.url);

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

export type CarouselSlide =
  | { type: "cover"; headline: string; subhint?: string; backgroundImageUrl?: string }
  | { type: "tweet"; body: string; bottomImageUrl?: string };

export interface CarouselAssets {
  displayName: string;
  handle: string;
  verified: boolean;
  profileImageUrl?: string;
}

type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: "normal" };
let fontsCache: FontEntry[] | null = null;

async function loadFonts(): Promise<FontEntry[]> {
  if (fontsCache) return fontsCache;
  const weights: Array<400 | 700 | 900> = [400, 700, 900];
  const out: FontEntry[] = [];
  for (const w of weights) {
    const fontPath = _require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`);
    const buf = await readFile(fontPath);
    out.push({
      name: "Inter",
      data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      weight: w,
      style: "normal",
    });
  }
  fontsCache = out;
  return out;
}

// Strip forbidden tokens before they ever land in a rendered slide.
// em/en dashes -> " - ", asterisks stripped, "big" -> "large", "leverage" -> "use".
function sanitize(text: string): string {
  return (text || "")
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, " - ")
    .replace(/\*+([^*]+)\*+/g, "$1")
    .replace(/\*/g, "")
    .replace(/\bbig\b/gi, (m) => (m === "BIG" ? "LARGE" : m === "Big" ? "Large" : "large"))
    .replace(/\bleverage\b/gi, (m) => (m === "LEVERAGE" ? "USE" : m === "Leverage" ? "Use" : "use"));
}

// Resolve a portal-served image URL into a base64 data URL satori can embed.
// SECURITY: only `/api/portal/images/:fileName` paths are accepted. We never
// fetch arbitrary http(s) URLs supplied by callers — that would be an SSRF
// vector (internal services, cloud metadata endpoints, etc). Already-encoded
// `data:image/...` URLs are passed through so unit tests can inject fixtures.
// The fileName is also validated to prevent path traversal in the bucket key.
async function imageToDataUrl(url: string): Promise<string> {
  if (!url || typeof url !== "string") throw new Error("imageToDataUrl: empty url");
  if (url.startsWith("data:image/")) return url;
  const portalMatch = url.match(/^\/api\/portal\/images\/([A-Za-z0-9._-]+)$/);
  if (!portalMatch) {
    throw new Error(
      "imageToDataUrl: only /api/portal/images/:fileName URLs are allowed (got: " +
        url.slice(0, 64) +
        ")",
    );
  }
  const fileName = portalMatch[1];
  if (fileName.includes("..") || fileName.startsWith(".")) {
    throw new Error("imageToDataUrl: invalid fileName");
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) throw new Error("Object storage env vars not set");
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  const downloadResult = await file.download();
  if (!downloadResult || !Array.isArray(downloadResult) || !downloadResult[0]) {
    throw new Error(`imageToDataUrl: download returned unexpected value for ${fileName}`);
  }
  const buf = downloadResult[0];
  let contentType = "image/png";
  try {
    const metaResult = await file.getMetadata();
    if (Array.isArray(metaResult) && metaResult[0]?.contentType) {
      contentType = String(metaResult[0].contentType);
    }
  } catch {
    // ignore metadata errors; default to png
  }
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

// Wrap satori vNodes with a tiny helper so the JSX-ish trees stay readable.
function el(type: string, props: Record<string, any> = {}, children?: any): any {
  const finalProps = { ...props };
  if (children !== undefined) {
    if (children !== null && typeof children === "object" && !Array.isArray(children)) {
      finalProps.children = [children];
    } else {
      finalProps.children = children;
    }
  }
  return { type, props: finalProps };
}

function buildCoverNode(slide: { headline: string; subhint?: string; backgroundDataUrl?: string }): any {
  const headline = sanitize(slide.headline).toUpperCase();
  const subhint = slide.subhint ? sanitize(slide.subhint) : "(Swipe left for the breakdown)";

  const layers: any[] = [];

  if (slide.backgroundDataUrl) {
    layers.push(
      el("img", {
        src: slide.backgroundDataUrl,
        style: { position: "absolute", top: 0, left: 0, width: SLIDE_W, height: SLIDE_H, objectFit: "cover" },
      }),
    );
  }
  // Always paint a darkening overlay so white text is readable
  layers.push(
    el("div", {
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        width: SLIDE_W,
        height: SLIDE_H,
        backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.55) 100%)",
        display: "flex",
      },
    }),
  );

  // Headline block, vertically centered
  layers.push(
    el(
      "div",
      {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: SLIDE_W,
          height: SLIDE_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "120px 80px",
        },
      },
      el(
        "div",
        {
          style: {
            color: "white",
            fontFamily: "Inter",
            fontWeight: 900,
            fontSize: headline.length > 60 ? 92 : headline.length > 30 ? 116 : 140,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            textAlign: "center",
            display: "flex",
          },
        },
        headline,
      ),
    ),
  );

  // Bottom swipe hint
  layers.push(
    el(
      "div",
      {
        style: {
          position: "absolute",
          bottom: 64,
          left: 0,
          width: SLIDE_W,
          display: "flex",
          justifyContent: "center",
        },
      },
      el(
        "div",
        {
          style: {
            color: "rgba(255,255,255,0.92)",
            fontFamily: "Inter",
            fontWeight: 400,
            fontSize: 28,
            display: "flex",
          },
        },
        subhint,
      ),
    ),
  );

  return el(
    "div",
    {
      style: {
        position: "relative",
        width: SLIDE_W,
        height: SLIDE_H,
        backgroundColor: "#0b0b0b",
        display: "flex",
      },
    },
    layers,
  );
}

function buildTweetNode(body: string, assets: CarouselAssets, bottomImageDataUrl?: string): any {
  const cleanBody = sanitize(body);
  const paragraphs = cleanBody.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const handle = assets.handle.startsWith("@") ? assets.handle : `@${assets.handle}`;

  // Header: profile pic + name/handle column
  const profileNode = assets.profileImageUrl
    ? el("img", {
        src: assets.profileImageUrl,
        style: { width: 96, height: 96, borderRadius: 48, objectFit: "cover", display: "flex" },
      })
    : el("div", {
        style: { width: 96, height: 96, borderRadius: 48, backgroundColor: "#e5e7eb", display: "flex" },
      });

  const verifiedBadge = assets.verified
    ? el(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: "#1d9bf0",
            color: "white",
            fontFamily: "Inter",
            fontWeight: 900,
            fontSize: 22,
            marginLeft: 4,
          },
        },
        "✓",
      )
    : null;

  const nameRow = el(
    "div",
    { style: { display: "flex", alignItems: "center" } },
    [
      el(
        "div",
        {
          style: {
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 36,
            color: "#0f1419",
            display: "flex",
          },
        },
        assets.displayName,
      ),
      verifiedBadge,
    ].filter(Boolean),
  );

  const handleRow = el(
    "div",
    {
      style: {
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: 28,
        color: "#536471",
        marginTop: 4,
        display: "flex",
      },
    },
    handle,
  );

  const headerCol = el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        marginLeft: 20,
      },
    },
    [nameRow, handleRow],
  );

  const headerRow = el(
    "div",
    { style: { display: "flex", alignItems: "center" } },
    [profileNode, headerCol],
  );

  const bodyChildren = paragraphs.map((p, i) =>
    el(
      "div",
      {
        style: {
          fontFamily: "Inter",
          fontWeight: 400,
          fontSize: paragraphs.length > 4 ? 40 : 46,
          lineHeight: 1.35,
          color: "#0f1419",
          display: "flex",
          marginTop: i === 0 ? 0 : 28,
        },
      },
      p,
    ),
  );

  const bodyBlock = el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        marginTop: 48,
        flexGrow: 1,
      },
    },
    bodyChildren,
  );

  const layers: any[] = [headerRow, bodyBlock];

  if (bottomImageDataUrl) {
    layers.push(
      el(
        "div",
        {
          style: {
            display: "flex",
            marginTop: 32,
            borderRadius: 24,
            overflow: "hidden",
            border: "1px solid #cfd9de",
          },
        },
        el("img", {
          src: bottomImageDataUrl,
          style: { width: SLIDE_W - 120, height: 540, objectFit: "cover", display: "flex" },
        }),
      ),
    );
  }

  return el(
    "div",
    {
      style: {
        width: SLIDE_W,
        height: SLIDE_H,
        backgroundColor: "white",
        display: "flex",
        flexDirection: "column",
        padding: 60,
      },
    },
    layers,
  );
}

async function nodeToPng(node: any): Promise<Buffer> {
  const fonts = await loadFonts();
  const svg = await satori(node, { width: SLIDE_W, height: SLIDE_H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: SLIDE_W } }).render().asPng();
  return Buffer.from(png);
}

export interface RenderOptions {
  // For tests: substitute the image fetcher
  resolveImage?: (url: string) => Promise<string>;
}

export async function renderCarouselToZip(
  slides: CarouselSlide[],
  assets: CarouselAssets,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const resolveImage = opts.resolveImage ?? imageToDataUrl;

  const profileDataUrl = assets.profileImageUrl ? await resolveImage(assets.profileImageUrl) : undefined;
  const tweetAssets: CarouselAssets = { ...assets, profileImageUrl: profileDataUrl };

  const zip = new JSZip();
  let i = 0;
  for (const slide of slides) {
    i++;
    let pngBuf: Buffer;
    try {
      if (slide.type === "cover") {
        const bg = slide.backgroundImageUrl ? await resolveImage(slide.backgroundImageUrl) : undefined;
        pngBuf = await nodeToPng(buildCoverNode({ headline: slide.headline, subhint: slide.subhint, backgroundDataUrl: bg }));
      } else {
        const bottom = slide.bottomImageUrl ? await resolveImage(slide.bottomImageUrl) : undefined;
        pngBuf = await nodeToPng(buildTweetNode(slide.body, tweetAssets, bottom));
      }
    } catch (err: any) {
      const slideDesc = slide.type === "cover" ? "cover" : `tweet "${(slide as any).body?.slice(0, 40)}..."`;
      throw new Error(`Failed to render slide ${i} (${slideDesc}): ${err?.message || err}`);
    }
    const num = String(i).padStart(2, "0");
    zip.file(`slide-${num}.png`, pngBuf);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
