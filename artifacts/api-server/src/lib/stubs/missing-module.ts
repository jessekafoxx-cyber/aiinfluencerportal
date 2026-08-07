function notInstalled(name: string): never {
  throw new Error(
    `Marketing-tool optional dependency "${name}" is not installed. ` +
    `Install it to enable this feature, or restrict this route via requireMarketingToolAccess.`
  );
}

const handler: ProxyHandler<object> = {
  get(_t, prop) {
    if (prop === "__esModule") return true;
    if (prop === "default") return new Proxy({}, handler);
    if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
    return new Proxy(function () { notInstalled(String(prop)); }, handler);
  },
  apply() { notInstalled("call"); },
  construct() { notInstalled("construct"); },
};

export default new Proxy({}, handler);
export const fal: any = new Proxy({}, handler);
export const ReplitConnectors: any = new Proxy(function () {}, handler);
export const bundle: any = new Proxy(function () {}, handler);
export const renderMedia: any = new Proxy(function () {}, handler);
export const selectComposition: any = new Proxy(function () {}, handler);
export const parse: any = new Proxy(function () {}, handler);
export const stringify: any = new Proxy(function () {}, handler);
export const extractRawText: any = new Proxy(function () {}, handler);
export const convertToHtml: any = new Proxy(function () {}, handler);
