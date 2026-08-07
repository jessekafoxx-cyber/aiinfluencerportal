// The VSL Masterclass chapter data lives in `@workspace/vsl-masterclass-content`
// so the api-server can import the same source-of-truth and render the print PDF
// without duplicating 1000+ lines of content. This shim keeps existing
// `@/content/vsl-masterclass` imports working in the portal.
export {
  VSL_MASTERCLASS_CHAPTERS,
  type Block,
  type Chapter,
} from "@workspace/vsl-masterclass-content";
