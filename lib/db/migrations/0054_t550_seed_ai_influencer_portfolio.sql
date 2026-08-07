-- Task #550: Seed the canonical "AI Influencer Portfolio" pre-built brain.
--
-- The admin Pre-Built Brains screen (/members/admin/prebuilt-brains) was
-- empty on every fresh DB even though the AI Influencer Portfolio brain is
-- the canonical seed example referenced throughout the codebase (DFY scripts
-- seeder OFFER_BRIEF, the portfolio page, schema comments). Nothing ever
-- inserted the row; admins had to recreate it by hand. This migration seeds
-- it once so it's always there.
--
-- IMPORTANT: this migration is data-only (INSERT ... ON CONFLICT DO NOTHING)
-- and contains no schema change. Per the replit.md gotcha "Production schema
-- changes belong to the Publish flow; data backfills are separate", this
-- file MUST be applied via the migration runner (`pnpm --filter
-- @workspace/scripts run apply:data-migrations`), NOT `drizzle-kit push` -
-- push silently skips data-only migrations.
--
-- Idempotent: re-running never duplicates the row and never overwrites edits
-- an admin has already saved (insert-if-missing only). The api-server boot
-- hook (`refreshPrebuiltBrainsCache` in
-- `artifacts/api-server/src/lib/prebuilt-brains.ts`) performs the same
-- insert-if-missing as a runtime safety net for any environment that
-- somehow skipped this migration.
--
-- Source of truth for the payload: `@workspace/prebuilt-brains-seed`. If you
-- change anything in that module, mirror the change here and re-run on a
-- fresh DB to confirm the row still inserts cleanly.

INSERT INTO prebuilt_brains (
  id,
  name,
  tagline,
  short_description,
  audience,
  highlights,
  badge,
  coming_soon,
  brain_data,
  generated_brain,
  source_notes,
  sort_order,
  is_active
) VALUES (
  'ai-influencer-portfolio',
  'AI Influencer Portfolio',
  'Done-for-you faceless AI income system',
  'Promote our flagship done-for-you offer. We build the AI influencer, the digital product, the sales page, the email automations and the backend. Your job is to plug into a system that''s already producing $57K+ days.',
  'Burnt-out employees, side-hustle consumers, financially pressured parents, sceptical ''burned before'' buyers, and quietly ambitious professionals who want online income without building anything from scratch.',
  '["$57K+ per day in real revenue","Over 32,000 customers served","Faceless content - no personal brand needed","We close every backend sale for you ($1K to $10K commissions)","Setup delivered inside 24 hours"]'::jsonb,
  NULL,
  false,
  jsonb_build_object(
    'name', 'AI Influencer Portfolio',
    'companyName', 'AI Influencer Portfolio',
    'whoDoYouHelp', 'Everyday people who want to build real online income without learning tech, building products, creating funnels, doing customer service, or putting their face on camera. Specifically: burnt-out employees who feel meant for more, side-hustle consumers stuck in research mode, financially pressured parents who need breathing room, sceptical buyers who have been burned before, and quietly ambitious professionals who feel under-expressed at work.',
    'howDoYouHelpThem', 'We build a complete done-for-you AI Influencer Portfolio inside 24 hours. That includes a custom faceless AI influencer, a fully built digital product, a high-converting sales page, email automations, the content system, and the full backend. The customer just promotes faceless AI-generated content (around 15 minutes a day). When sales come in they earn $100+ per front-end sale and $1,000-$10,000 per backend sale that we close for them. They keep 100% of profits while we handle delivery, customer service and high-ticket sales.',
    'keyAchievements', 'Currently generating $57,000+ per day with this exact model. Over $700,000 per month. Helped 32,000+ people get started. Featured in Forbes, Entrepreneur, The Independent and the Daily Express. Spoken on stages globally. Our founder''s prior track record: built a 6-figure eCommerce brand from £80, scaled a Shopify agency to 3,000+ clients and 42 staff before exiting in 2021, served as CMO across 8- and 9-figure companies, then scaled a one-person digital product business to $724K/month in under 188 days.'
  ),
  E'OFFER: AI Influencer Portfolio (DFY)\n\nWhat it is (one paragraph):\nOur done-for-you AI Influencer Portfolio is a fully built online\nbusiness delivered in 24 hours. We hand the customer a custom faceless AI\ninfluencer in a niche with proven demand, a digital product ready to sell, a\nhigh-converting sales page, full email automations, a content system, and the\nentire backend. The customer does NOT build, learn tech, write copy, do\ncustomer service, or appear on camera. They post around 3-5 short faceless AI\nvideos per day (under 20 minutes of work) and we handle product delivery,\nsupport and all backend sales. They earn ~$100+ per front-end sale and\n$1,000-$10,000 per backend sale that we close. Realistic scale per AI\ninfluencer: $1K-$3K per day in profit. Customers can run multiple AI\ninfluencers as a portfolio.\n\nProof numbers (use only these, never invent new ones):\n- $57,000+ per day current revenue with this exact model\n- $700,000+ per month run rate, $394K net profit\n- 32,000+ people have started building with this system\n- Featured in Forbes, Entrepreneur, The Independent, Daily Express\n- Our founder has spoken on stages worldwide teaching this model\n\nOur founder''s authority (use to defuse "is this legit?"):\n- Built a 6-figure Shopify brand at age 15 starting with 80 GBP\n- Scaled a Shopify web design agency to 3,000+ clients and 42 staff\n- Built one of the first Fiverr accounts to clear $1M+ revenue\n- Exited the agency in 2021, moved to Dubai\n- CMO across 8 and 9 figure companies in eCommerce, finance, real estate\n- Scaled a one-person digital product business to $724K/month in under 188 days\n- Father of a young son - uses this model specifically because it gives time back\n\nWhat we are NOT:\n- Not a course, not a side hustle\n- Not dropshipping, affiliate marketing, or a faceless page model where they\n  still build everything\n- Not "learn this skill and one day you''ll succeed"\n- Not a personal brand requiring them on camera\n- Not "make money online" hype with no infrastructure\n\nAudience: burnt-out employees, side-hustle consumers, financially pressured\nparents, sceptical ''burned before'' buyers, quietly ambitious professionals\nwho want online income without building anything from scratch.\n\nTone: direct, confident, numbers-heavy. No hype words ("game-changer",\n"revolutionary", "secret"). No fake urgency. Lead with the proof, then the\nproblem, then the solution, then the simple next action.',
  NULL,
  0,
  true
) ON CONFLICT (id) DO NOTHING;
