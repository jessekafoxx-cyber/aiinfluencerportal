// Canonical seed payload for the "AI Influencer Portfolio" pre-built brain.
//
// Shared between:
//   - the API server's prebuilt_brains cache loader (boot-time
//     insert-if-missing safety net), in
//     `artifacts/api-server/src/lib/prebuilt-brains.ts`
//   - the DFY scripts seeder (`scripts/src/seed-dfy-scripts.ts`), which uses
//     the offer brief as the OFFER section of every script-generation prompt
//   - the SQL seed migration `lib/db/migrations/0054_t550_seed_ai_influencer_portfolio.sql`
//
// All three sources of truth must agree on the offer copy, so it lives here
// once. If you change anything in this file you must also re-run the seed
// migration on a fresh DB to confirm the row still inserts cleanly.

export interface PrebuiltBrainSeed {
  id: string;
  name: string;
  tagline: string;
  shortDescription: string;
  audience: string;
  highlights: string[];
  badge: string | null;
  comingSoon: boolean;
  brainData: {
    name: string;
    companyName: string;
    whoDoYouHelp: string;
    howDoYouHelpThem: string;
    keyAchievements: string;
  };
  generatedBrain: string;
  sortOrder: number;
  isActive: boolean;
}

// The plain-prose offer brief used as the OFFER block in every DFY-script
// prompt and as the `generated_brain` document for the AI Influencer
// Portfolio pre-built brain. Same string in both places by design.
export const AI_INFLUENCER_PORTFOLIO_OFFER_BRIEF = `OFFER: AI Influencer Portfolio (DFY)

What it is (one paragraph):
Our done-for-you AI Influencer Portfolio is a fully built online
business delivered in 24 hours. We hand the customer a custom faceless AI
influencer in a niche with proven demand, a digital product ready to sell, a
high-converting sales page, full email automations, a content system, and the
entire backend. The customer does NOT build, learn tech, write copy, do
customer service, or appear on camera. They post around 3-5 short faceless AI
videos per day (under 20 minutes of work) and we handle product delivery,
support and all backend sales. They earn ~$100+ per front-end sale and
$1,000-$10,000 per backend sale that we close. Realistic scale per AI
influencer: $1K-$3K per day in profit. Customers can run multiple AI
influencers as a portfolio.

Proof numbers (use only these, never invent new ones):
- $57,000+ per day current revenue with this exact model
- $700,000+ per month run rate, $394K net profit
- 32,000+ people have started building with this system
- Featured in Forbes, Entrepreneur, The Independent, Daily Express
- Our founder has spoken on stages worldwide teaching this model

Our founder's authority (use to defuse "is this legit?"):
- Built a 6-figure Shopify brand at age 15 starting with 80 GBP
- Scaled a Shopify web design agency to 3,000+ clients and 42 staff
- Built one of the first Fiverr accounts to clear $1M+ revenue
- Exited the agency in 2021, moved to Dubai
- CMO across 8 and 9 figure companies in eCommerce, finance, real estate
- Scaled a one-person digital product business to $724K/month in under 188 days
- Father of a young son - uses this model specifically because it gives time back

What we are NOT:
- Not a course, not a side hustle
- Not dropshipping, affiliate marketing, or a faceless page model where they
  still build everything
- Not "learn this skill and one day you'll succeed"
- Not a personal brand requiring them on camera
- Not "make money online" hype with no infrastructure

Audience: burnt-out employees, side-hustle consumers, financially pressured
parents, sceptical 'burned before' buyers, quietly ambitious professionals
who want online income without building anything from scratch.

Tone: direct, confident, numbers-heavy. No hype words ("game-changer",
"revolutionary", "secret"). No fake urgency. Lead with the proof, then the
problem, then the solution, then the simple next action.`;

export const AI_INFLUENCER_PORTFOLIO_SEED: PrebuiltBrainSeed = {
  id: "ai-influencer-portfolio",
  name: "AI Influencer Portfolio",
  tagline: "Done-for-you faceless AI income system",
  shortDescription:
    "Promote our flagship done-for-you offer. We build the AI influencer, the digital product, the sales page, the email automations and the backend. Your job is to plug into a system that's already producing $57K+ days.",
  audience:
    "Burnt-out employees, side-hustle consumers, financially pressured parents, sceptical 'burned before' buyers, and quietly ambitious professionals who want online income without building anything from scratch.",
  highlights: [
    "$57K+ per day in real revenue",
    "Over 32,000 customers served",
    "Faceless content - no personal brand needed",
    "We close every backend sale for you ($1K to $10K commissions)",
    "Setup delivered inside 24 hours",
  ],
  badge: null,
  comingSoon: false,
  brainData: {
    name: "AI Influencer Portfolio",
    companyName: "AI Influencer Portfolio",
    whoDoYouHelp:
      "Everyday people who want to build real online income without learning tech, building products, creating funnels, doing customer service, or putting their face on camera. Specifically: burnt-out employees who feel meant for more, side-hustle consumers stuck in research mode, financially pressured parents who need breathing room, sceptical buyers who have been burned before, and quietly ambitious professionals who feel under-expressed at work.",
    howDoYouHelpThem:
      "We build a complete done-for-you AI Influencer Portfolio inside 24 hours. That includes a custom faceless AI influencer, a fully built digital product, a high-converting sales page, email automations, the content system, and the full backend. The customer just promotes faceless AI-generated content (around 15 minutes a day). When sales come in they earn $100+ per front-end sale and $1,000-$10,000 per backend sale that we close for them. They keep 100% of profits while we handle delivery, customer service and high-ticket sales.",
    keyAchievements:
      "Currently generating $57,000+ per day with this exact model. Over $700,000 per month. Helped 32,000+ people get started. Featured in Forbes, Entrepreneur, The Independent and the Daily Express. Spoken on stages globally. Our founder's prior track record: built a 6-figure eCommerce brand from £80, scaled a Shopify agency to 3,000+ clients and 42 staff before exiting in 2021, served as CMO across 8- and 9-figure companies, then scaled a one-person digital product business to $724K/month in under 188 days.",
  },
  generatedBrain: AI_INFLUENCER_PORTFOLIO_OFFER_BRIEF,
  sortOrder: 0,
  isActive: true,
};
