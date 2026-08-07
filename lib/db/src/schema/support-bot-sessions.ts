import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Room30 AI Support Bot - anonymous chat sessions for the embeddable
// widget. No auth: sessions are keyed by a server-generated UUID stored
// in the visitor's localStorage. Distinct from support_chats (portal,
// Clerk-authed).

export type SupportBotMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type SupportBotSessionMetadata = {
  bugCollecting?: boolean;
  bugSubmittedAt?: string;
  lastIntent?: string;
  pageUrl?: string;
  escalationOfferedAt?: string;
  escalatedEmailSentAt?: string;
  // Set once the customer supplies their email in a purchase/access
  // context. From then on, account context is injected on every turn so
  // the bot never re-asks for the email or promises to "check later".
  purchaseLookupUnlocked?: boolean;
  // Refund flow: set on a refund_request intent; exposes the
  // issue_refund tool + injects refund eligibility once email is known.
  refundContext?: boolean;
  refundIssuedAt?: string;
  refundedOrderId?: string;
  // Email-ownership verification before a refund executes: a 6-digit
  // code is emailed to the checkout address and only its sha256 hash
  // (keyed to session + email) is stored here.
  refundVerifyEmail?: string;
  refundVerifyCodeHash?: string;
  refundVerifySentAt?: string;
  refundVerifyAttempts?: number;
  refundEmailVerifiedAt?: string;
  // Stamped when the model calls issue_refund with confirm=true; once
  // the code checks out the refund executes without another model turn.
  refundConfirmedAt?: string;
  // AI influencer stuck-generation flow: set on influencer_stuck
  // intent; exposes the escalate_influencer_generation tool.
  influencerComplaint?: boolean;
  influencerEscalatedAt?: string;
};

export const supportBotSessionsTable = pgTable(
  "support_bot_sessions",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    messages: jsonb("messages")
      .$type<SupportBotMessage[]>()
      .notNull()
      .default([]),
    metadata: jsonb("metadata")
      .$type<SupportBotSessionMetadata>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("support_bot_sessions_email_idx").on(t.email),
    index("support_bot_sessions_created_at_idx").on(t.createdAt),
  ],
);

export type SupportBotSessionRow = typeof supportBotSessionsTable.$inferSelect;
