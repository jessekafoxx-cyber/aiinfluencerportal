import { db, pageNotesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const PAGE_SLUG = "tiktok-slideshow-masterclass";
const PAGE_TITLE = "TikTok AI Slideshow Masterclass";

// Full lesson notes for the TikTok AI Slideshow Masterclass, converted from
// the uploaded lesson text. Admins can still replace this in the UI at any
// time - the seeder will not overwrite edits because it only runs when the
// row is missing or empty.
export const TIKTOK_SLIDESHOW_NOTES_HTML = `<h2>🔴 WHAT: TIKTOK AI SLIDESHOW AUTOMATION</h2><p>Welcome to the <strong>TikTok AI slideshow masterclass</strong>. This lesson covers how to create engaging TikTok slideshows using AI with complete automation through the Reel.Farm tool. This method simplifies slideshow creation while ensuring impactful and authentic content.</p><hr><h2>🟠 WHY: THE POWER OF AI SLIDESHOWS</h2><p>TikTok slideshows are a trending format used on platforms like TikTok and Instagram. They are essentially carousels with an authentic, casual design style intended to grab attention quickly. Why use them?</p><ul><li><p>Convey large amounts of information in a simple and engaging way</p></li><li><p>Authentic and relatable aesthetic increases viewer retention</p></li><li><p>Highly versatile for niches like marketing, self-improvement, dating, motivation, and more</p></li><li><p>Enables massive reach, evidenced by viral posts reaching millions of likes and views</p></li><li><p>Perfect for both influencer-focused content and faceless content strategies</p></li></ul><blockquote><p>💡 TikTok slideshows offer a unique opportunity to scale content creation while staying relevant and engaging for the audience.</p></blockquote><hr><h2>🟢 HOW: MASTERING REEL.FARM SLIDESHOW AUTOMATION</h2><h3>STEP 1: SET UP REEL.FARM</h3><p>Start by accessing Reel.Farm, the AI tool that automates TikTok slideshow creation. You'll find it linked below this video. Once inside the tool:</p><ul><li><p>Go to <strong>Products</strong> and click <strong>Add New Product</strong>.</p></li><li><p>Enter the product's website URL or sales page (e.g., room30.ai/offer).</p></li><li><p>The AI scans the URL and auto-generates hooks, target audience details, and more.</p></li><li><p>Check the generated details for accuracy, and rename the product to fit your niche.</p></li></ul><h3>STEP 2: CREATE AUTOMATION</h3><p>Once the product is set up:</p><ul><li><p>Navigate to <strong>Automations</strong> and create a new automation.</p></li><li><p>Select a template (e.g., Hustlecore, Mindset Shift, etc.). The template adjusts to your niche.</p></li><li><p>Connect your TikTok account directly through settings.</p></li><li><p>Set the posting schedule (e.g., three posts a day) and allow the AI to generate content automatically.</p></li></ul><blockquote><p>⚙️ Customize as needed: Add hooks, tailor slideshows, and enable CTAs for higher conversions.</p></blockquote><h3>STEP 3: TEST AND REFINE</h3><p>Run generation tests to review the slideshow quality:</p><ul><li><p>Try toggling between auto images and manual image uploads for the most authentic look.</p></li><li><p>Add customized CTAs like "Comment or DM me for more" for a stronger call to action.</p></li><li><p>Experiment with different tones, styles, and hook strategies to find what resonates most with the audience.</p></li></ul><hr><h2>🟢 HOW: CREATING INFLUENCER-SPECIFIC SLIDESHOWS</h2><h3>STEP 1: BUILD IMAGE COLLECTIONS</h3><p>For influencer-specific content, curate images that match your AI influencer's branding:</p><ul><li><p>Use <strong>Reel.Farm Database</strong> to save hook images and content slides.</p></li><li><p>Run each image through tools like Higgs.Farm Character Swap to replace models or avatars with your influencer.</p></li><li><p>Remove unnecessary text from images using AI prompt tools, ensuring clean visuals.</p></li><li><p>Create targeted collections like "Influencer Hooks" and "Content Mark" within Reel.Farm.</p></li></ul><blockquote><p>⚡ Personalization matters: Ensure images align with your influencer's identity for consistency.</p></blockquote><h3>STEP 2: INTEGRATE INTO AUTOMATION</h3><ul><li><p>Set your slideshow format, pairing hooks with corresponding collections tailored to your influencer.</p></li><li><p>Enable CTA with custom text for stronger audience engagement (e.g., "Message me for exclusive content").</p></li><li><p>Fine-tune slide styles and generate posts for consistent, streamlined content output.</p></li></ul><h3>STEP 3: SCALE WITH MULTIPLE AUTOMATIONS</h3><p>Expand reach by creating multiple TikTok accounts focusing on different niches or topics. Customize hooks and styles for variety while leveraging the AI for efficiency.</p><blockquote><p>📌 Tip: Time invested in refining hooks and visuals upfront leads to better engagement and results later.</p></blockquote><hr><h2>🔗 RESOURCES AND NEXT STEPS</h2><p>Use these links and tools to dive deeper:</p><ul><li><p><strong>Reel.Farm:</strong> Comprehensive TikTok slideshow automation tool</p></li><li><p><strong>Higgs.Farm:</strong> AI-driven image editor for influencer customization</p></li><li><p><strong>2,000 Hook Library:</strong> Exclusive hook library accessible through the course portal</p></li></ul><blockquote><p>🎯 Leverage AI to create high-performing TikTok and Instagram slideshows. Scale efficiently and dominate your niche!</p></blockquote>`;

export async function ensureTikTokSlideshowNotes(): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(pageNotesTable)
      .where(eq(pageNotesTable.pageSlug, PAGE_SLUG));

    if (existing && existing.notes && existing.notes.trim().length > 0) {
      // Targeted backfill: replace the old short placeholder block (shipped
      // before the real lesson notes existed) with the full notes. Detected
      // by its distinctive closing sentence so genuine admin edits are safe.
      const isOldPlaceholder = existing.notes.includes(
        "These notes are placeholder copy that will be expanded",
      );
      if (isOldPlaceholder) {
        await db
          .update(pageNotesTable)
          .set({
            pageTitle: PAGE_TITLE,
            notes: TIKTOK_SLIDESHOW_NOTES_HTML,
            updatedAt: new Date(),
          })
          .where(eq(pageNotesTable.id, existing.id));
        logger.info(
          { pageSlug: PAGE_SLUG },
          "ensureTikTokSlideshowNotes: replaced old placeholder with full notes",
        );
        return;
      }
      // Admin may have edited this in the UI - never overwrite their changes.
      return;
    }

    if (existing) {
      await db
        .update(pageNotesTable)
        .set({
          pageTitle: PAGE_TITLE,
          notes: TIKTOK_SLIDESHOW_NOTES_HTML,
          updatedAt: new Date(),
        })
        .where(eq(pageNotesTable.id, existing.id));
      logger.info({ pageSlug: PAGE_SLUG }, "ensureTikTokSlideshowNotes: filled empty row");
      return;
    }

    await db.insert(pageNotesTable).values({
      pageSlug: PAGE_SLUG,
      pageTitle: PAGE_TITLE,
      notes: TIKTOK_SLIDESHOW_NOTES_HTML,
    });
    logger.info({ pageSlug: PAGE_SLUG }, "ensureTikTokSlideshowNotes: seeded notes row");
  } catch (err) {
    logger.error({ err }, "ensureTikTokSlideshowNotes: failed");
  }
}
