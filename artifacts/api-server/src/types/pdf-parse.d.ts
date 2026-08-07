declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (buffer: Buffer | Uint8Array) => Promise<{ text: string; numpages: number; info: unknown; metadata: unknown; version: string }>;
  export default pdfParse;
}
