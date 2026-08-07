import "@replit/connectors-sdk";

declare module "@replit/connectors-sdk" {
  interface ProxyOptions {
    query?: Record<string, string>;
  }
}
