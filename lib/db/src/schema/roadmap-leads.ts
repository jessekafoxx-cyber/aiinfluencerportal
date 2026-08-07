import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const roadmapLeadsTable = pgTable("roadmap_leads", {
  id: serial("id").primaryKey(),
  shareToken: text("share_token").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  country: text("country"),
  niche: text("niche").notNull(),
  revenueBand: text("revenue_band").notNull(),
  audienceSize: text("audience_size"),
  currentOffer: text("current_offer"),
  bottleneck: text("bottleneck"),
  generatedOffers: jsonb("generated_offers"),
  generationStatus: text("generation_status").notNull().default("pending"),
  generationError: text("generation_error"),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailMessageId: text("email_message_id"),
  fbp: text("fbp"),
  fbc: text("fbc"),
  clientIpAddress: text("client_ip_address"),
  clientUserAgent: text("client_user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roadmapLeadEventsTable = pgTable("roadmap_lead_events", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => roadmapLeadsTable.id, { onDelete: "set null" }),
  shareToken: text("share_token"),
  eventName: text("event_name").notNull(),
  step: text("step"),
  cta: text("cta"),
  context: jsonb("context"),
  clientIpAddress: text("client_ip_address"),
  clientUserAgent: text("client_user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RoadmapLead = typeof roadmapLeadsTable.$inferSelect;
export type InsertRoadmapLead = typeof roadmapLeadsTable.$inferInsert;
export type RoadmapLeadEvent = typeof roadmapLeadEventsTable.$inferSelect;

export type RoadmapPriceTier = {
  name: string;
  promise: string;
  price: number;
  priceLabel: string;
  whatsInside: string[];
  priceRationale: string;
};

export type RoadmapLowTicketFormat =
  | "Live 5-Day Challenge Funnel"
  | "Course + AI Operating System"
  | "Done-For-You Templates";

export type RoadmapLowTicketStack = {
  format: RoadmapLowTicketFormat;
  formatRationale: string;
  why: string;
  economics: string;
  mainOffer: RoadmapPriceTier;
  orderBumps: RoadmapPriceTier[];
  upsells: RoadmapPriceTier[];
};

export type RoadmapPremiumStack = {
  why: string;
  offerName: string;
  promise: string;
  format: string;
  deliverables: string[];
  experienceLayer: string;
  idealClient: string;
  price: number;
  priceLabel: string;
  priceRationale: string;
  objectionHandling: string[];
  salesConversation: string[];
};

export type RoadmapHundredKStack = {
  why: string;
  mindsetShift: string;
  offerName: string;
  coreConcept: string;
  deliverables: string[];
  experienceLayer: string;
  transformation: string;
  price: number;
  priceLabel: string;
  profitMargin: string;
  deliveryPlan: string;
  idealClient: string;
  scarcity: string;
};

export type RoadmapOffers = {
  intro: string;
  lowTicket: RoadmapLowTicketStack;
  premium: RoadmapPremiumStack;
  hundredK: RoadmapHundredKStack;
};
