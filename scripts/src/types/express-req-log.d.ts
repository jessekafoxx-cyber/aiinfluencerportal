// Shim so transitive imports from @workspace/api-server (which use
// `req.log` provided at runtime by pino-http) don't surface as type
// errors in the scripts package, which doesn't depend on pino-http.
// This file is types-only and has no runtime effect.
declare global {
  namespace Express {
    interface Request {
      log?: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        debug: (...args: unknown[]) => void;
        trace: (...args: unknown[]) => void;
        fatal: (...args: unknown[]) => void;
        child: (...args: unknown[]) => unknown;
      };
    }
  }
}
export {};
