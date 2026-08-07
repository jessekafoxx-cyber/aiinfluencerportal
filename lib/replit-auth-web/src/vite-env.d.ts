// Minimal Vite env typing so this package compiles standalone (the
// consuming app provides the real vite/client types at bundle time).
interface ImportMeta {
  readonly env: {
    readonly BASE_URL: string;
  };
}
