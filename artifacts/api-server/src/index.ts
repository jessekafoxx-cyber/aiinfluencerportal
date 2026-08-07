// Deprecated entrypoint kept for one release as an alias for the API
// runtime so existing run configs that still target `dist/index.mjs` keep
// working. Remove after the `Media Worker` workflow has been verified
// green in production. See Task #140.
import "./index.api";
