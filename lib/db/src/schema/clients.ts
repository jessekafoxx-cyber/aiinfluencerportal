import { appUsers } from "./users";

export const clientsTable = appUsers;
export type Client = typeof appUsers.$inferSelect;
