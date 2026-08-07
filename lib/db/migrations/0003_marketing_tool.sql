-- Marketing Tool import: per-user isolated tables (task #39)
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS "assets" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "category" text NOT NULL,
  "name" text NOT NULL,
  "content" text NOT NULL,
  "source_type" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "brain_sources" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" varchar(255),
  "kind" varchar(32) NOT NULL,
  "label" text NOT NULL,
  "source_url" text,
  "external_id" varchar(255),
  "content" text,
  "focus_notes" text,
  "ignore_notes" text,
  "status" varchar(16) NOT NULL DEFAULT 'ready'::character varying,
  "error_message" text,
  "metadata" jsonb,
  "content_chars" integer NOT NULL DEFAULT 0,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "broll_assets" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "object_path" text NOT NULL,
  "file_type" text NOT NULL,
  "category" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "calendar_entries" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "date" date NOT NULL,
  "slot_number" integer NOT NULL,
  "content_type" text NOT NULL,
  "awareness_stage" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "caption" text,
  "clip_project_id" text,
  "clip_id" text,
  "youtube_url" text,
  "reference_video_url" text,
  "reference_note" text,
  "platforms" jsonb DEFAULT '["tiktok", "youtube_shorts", "instagram", "facebook"]'::jsonb,
  "status" text NOT NULL DEFAULT 'planned'::text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "camo_ads" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "ad_type" text NOT NULL,
  "title" text NOT NULL,
  "topic" text NOT NULL,
  "awareness_stage" text NOT NULL,
  "hook" text,
  "body_copy" text,
  "cta" text,
  "image_prompt" text,
  "video_script" text,
  "scene_setting" text,
  "metadata" jsonb,
  "status" text NOT NULL DEFAULT 'generated'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "competitor_channels" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "platform" text NOT NULL,
  "handle" text NOT NULL,
  "display_name" text,
  "profile_url" text,
  "last_scraped_at" timestamp with time zone,
  "metadata" jsonb,
  "clerk_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "competitor_scraped_pages" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "competitor_id" integer NOT NULL,
  "url" text NOT NULL,
  "page_title" text,
  "page_content" text,
  "page_type" text,
  "scraped_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "competitor_sites" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "offer_id" integer,
  "domain" text NOT NULL,
  "name" text NOT NULL,
  "urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "fb_page_id" text,
  "fb_page_name" text,
  "last_scraped_at" timestamp with time zone,
  "last_ad_scraped_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "competitor_video_ideas" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" text,
  "based_on_video_ids" jsonb,
  "brain_stats" jsonb,
  "ideas" jsonb,
  "raw_output" text,
  "status" text NOT NULL DEFAULT 'processing'::text,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "competitor_videos" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "channel_id" integer NOT NULL,
  "platform" text NOT NULL,
  "video_id" text NOT NULL,
  "url" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "thumbnail_url" text,
  "duration_sec" integer,
  "view_count" integer,
  "like_count" integer,
  "comment_count" integer,
  "published_at" timestamp with time zone,
  "is_short" boolean NOT NULL DEFAULT false,
  "is_outlier" boolean NOT NULL DEFAULT false,
  "outlier_multiplier" real,
  "channel_median_views" integer,
  "metadata" jsonb,
  "clerk_id" text,
  "scraped_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "content_creators" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "platform" text NOT NULL,
  "handle" text NOT NULL,
  "display_name" text,
  "profile_url" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "copywriting_guidelines" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "creator_videos" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "creator_id" integer NOT NULL,
  "platform" text NOT NULL,
  "video_url" text NOT NULL,
  "thumbnail_url" text,
  "caption" text,
  "view_count" integer,
  "like_count" integer,
  "comment_count" integer,
  "duration" integer,
  "hashtags" jsonb,
  "scraped_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "daily_profit_entries" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "entry_date" date NOT NULL,
  "low_ticket_sales" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "backend_deals" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "other_income" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "ad_spend" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "stripe_fees" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "other_costs" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "vat_sales" numeric(12,2) NOT NULL DEFAULT '0'::numeric,
  "low_ticket_override" boolean NOT NULL DEFAULT false,
  "backend_deals_override" boolean NOT NULL DEFAULT false,
  "other_income_override" boolean NOT NULL DEFAULT false,
  "ad_spend_override" boolean NOT NULL DEFAULT false,
  "stripe_fees_override" boolean NOT NULL DEFAULT false,
  "other_costs_override" boolean NOT NULL DEFAULT false,
  "vat_sales_override" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "data_sources" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "platform" text NOT NULL,
  "api_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "last_sync_at" timestamp with time zone,
  "last_sync_result" jsonb,
  "synced_data" jsonb,
  "clerk_id" text,
  "offer_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "editing_styles" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "style_key" text NOT NULL,
  "label" text NOT NULL,
  "source_type" text NOT NULL DEFAULT 'manual'::text,
  "thumbnail_url" text,
  "preferences" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "episodes" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "youtube_title" text,
  "youtube_description" text,
  "audio_path" text,
  "video_path" text,
  "duration" integer,
  "file_size" integer,
  "status" text NOT NULL DEFAULT 'processing'::text,
  "podbean_episode_id" text,
  "podbean_media_key" text,
  "podbean_url" text,
  "podbean_status" text DEFAULT 'pending'::text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "face_clones" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "object_path" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fb_ad_comments" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "fb_comment_id" text NOT NULL,
  "fb_post_id" text NOT NULL,
  "ad_name" text,
  "commenter_name" text NOT NULL,
  "commenter_id" text,
  "comment_text" text NOT NULL,
  "comment_time" timestamp with time zone,
  "reply_text" text,
  "reply_status" text NOT NULL DEFAULT 'pending'::text,
  "replied_at" timestamp with time zone,
  "fb_reply_id" text,
  "sentiment" text,
  "flagged" boolean NOT NULL DEFAULT false,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fb_bot_config" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "ad_account_id" text,
  "page_id" text,
  "page_name" text,
  "auto_reply_enabled" boolean NOT NULL DEFAULT false,
  "reply_delay_seconds" integer NOT NULL DEFAULT 30,
  "reply_rules" text,
  "tone_guide" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "financial_entries" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "type" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric NOT NULL,
  "entry_date" date NOT NULL,
  "source" text NOT NULL DEFAULT 'manual'::text,
  "metadata" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kpi_entries" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "value" numeric NOT NULL,
  "target" numeric,
  "unit" text NOT NULL DEFAULT 'number'::text,
  "period" text NOT NULL DEFAULT 'monthly'::text,
  "category" text NOT NULL DEFAULT 'general'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "learned_exemplars" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" text,
  "tool" text NOT NULL,
  "kind" text NOT NULL,
  "title" text,
  "content" text NOT NULL,
  "original_content" text,
  "user_instruction" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mt_conversations" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "type" text NOT NULL DEFAULT 'framework'::text,
  "clerk_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mt_messages" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "conversation_id" integer NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "offers" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "clerk_id" text,
  "high_ticket_details" text,
  "low_ticket_details" text,
  "premium_details" text,
  "hundred_k_details" text,
  "upsell_details" text,
  "vsl_summary" text,
  "urls" jsonb,
  "positioning" text,
  "mechanism" text,
  "bonuses" text,
  "guarantees" text,
  "pricing" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reddit_comments" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "comment_id" text NOT NULL,
  "post_id" text NOT NULL,
  "subreddit" text NOT NULL,
  "body" text NOT NULL,
  "score" integer DEFAULT 0,
  "author" text,
  "dimension" text,
  "offer_id" integer,
  "clerk_id" text,
  "scraped_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reddit_posts" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "post_id" text NOT NULL,
  "subreddit" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "url" text,
  "score" integer DEFAULT 0,
  "num_comments" integer DEFAULT 0,
  "dimension" text,
  "offer_id" integer,
  "clerk_id" text,
  "scraped_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "research_docs" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "tags" text,
  "metadata" jsonb,
  "clerk_id" text,
  "offer_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "script_rewrites" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" varchar(255),
  "source_url" text NOT NULL,
  "platform" varchar(32) NOT NULL,
  "source_title" text,
  "source_author" text,
  "source_thumbnail" text,
  "video_url" text,
  "transcript" text,
  "user_prompt" text,
  "own_version" text,
  "rewritten_script" text,
  "status" varchar(32) NOT NULL DEFAULT 'pending'::character varying,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "short_form_scripts" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" varchar(255),
  "topic" text NOT NULL,
  "niche" text,
  "audience" text,
  "result" text,
  "proof" text,
  "cta" text,
  "idea" text,
  "example_transcript" text,
  "awareness_stage" varchar(32),
  "variation_count" varchar(4) NOT NULL DEFAULT '1'::character varying,
  "variations" jsonb,
  "brain_stats" jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'processing'::character varying,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "social_comments" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "comment_id" text NOT NULL,
  "platform" text NOT NULL,
  "source_url" text,
  "video_title" text,
  "channel_name" text,
  "comment_text" text NOT NULL,
  "author" text,
  "like_count" integer DEFAULT 0,
  "reply_count" integer DEFAULT 0,
  "offer_id" integer NOT NULL,
  "clerk_id" text,
  "scraped_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "static_ad_assets" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "offer_id" integer NOT NULL,
  "filename" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" integer,
  "mime_type" text,
  "category" text DEFAULT 'Other'::text,
  "asset_role" text DEFAULT 'general'::text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "static_ad_brand_intelligence" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "offer_id" integer NOT NULL,
  "persona" text NOT NULL,
  "angle" text NOT NULL,
  "pain_point" text,
  "emotion" text,
  "source" text DEFAULT 'manual'::text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "static_ad_brand_kits" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "offer_id" integer NOT NULL,
  "primary_color" text,
  "secondary_color" text,
  "accent_color" text,
  "background_color" text,
  "font_headline" text,
  "font_body" text,
  "logo_path" text,
  "typography_style" text,
  "guidelines" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "static_ad_generations" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "offer_id" integer NOT NULL,
  "reference_image_path" text,
  "product_image_path" text,
  "prompt" text,
  "concept_name" text,
  "avatar_name" text,
  "size" text DEFAULT '1:1'::text,
  "used_brand_kit" boolean DEFAULT false,
  "generated_images" jsonb,
  "status" text DEFAULT 'completed'::text,
  "generation_mode" text DEFAULT 'remix'::text,
  "format_id" text,
  "concept_index" integer,
  "ad_detail_meta" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "static_ad_offers" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "landing_page_url" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "static_ad_templates" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "offer_id" integer NOT NULL,
  "name" text NOT NULL,
  "format_id" text,
  "description" text,
  "prompt_template" text,
  "reference_image_path" text,
  "aspect_ratio" text DEFAULT '1:1'::text,
  "tone" text,
  "target_avatar" text,
  "concept_angle" text,
  "offer_cta" text,
  "tags" jsonb,
  "usage_count" integer DEFAULT 0,
  "avg_rating" real,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "story_sequences" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "topic" text NOT NULL,
  "awareness_stage" text NOT NULL,
  "cta_type" text NOT NULL,
  "cta_text" text NOT NULL,
  "cta_link" text,
  "slide_count" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'generated'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "story_slides" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "sequence_id" integer NOT NULL,
  "slide_number" integer NOT NULL,
  "slide_type" text NOT NULL,
  "copy_lines" jsonb NOT NULL,
  "image_prompt" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "swipe_file_items" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" text NOT NULL,
  "source_url" text NOT NULL,
  "platform" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "error_msg" text,
  "media_type" text,
  "local_media_file" text,
  "local_thumb_file" text,
  "external_media_url" text,
  "caption" text,
  "author_name" text,
  "author_handle" text,
  "published_at" timestamp with time zone,
  "metrics_json" jsonb,
  "transcription_status" text NOT NULL DEFAULT 'idle'::text,
  "transcript" text,
  "ai_concepts" text,
  "ai_concepts_at" timestamp with time zone,
  "tags" jsonb,
  "notes" text,
  "scraped_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "swipe_file_sources" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" text NOT NULL,
  "sheet_url" text NOT NULL,
  "sheet_id" text NOT NULL,
  "sheet_tab" text NOT NULL DEFAULT 'Sheet1'::text,
  "url_column" text NOT NULL DEFAULT 'A'::text,
  "start_row" integer NOT NULL DEFAULT 2,
  "last_synced_at" timestamp with time zone,
  "last_sync_summary" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "thumbnail_projects" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "youtube_url" text,
  "template_id" text,
  "face_clone_id" text,
  "headline_top" text,
  "headline_bottom" text,
  "expression" text,
  "generated_image_path" text,
  "status" text NOT NULL DEFAULT 'draft'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "thumbnail_templates" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "category" text NOT NULL,
  "description" text,
  "layout_config" text NOT NULL,
  "preview_url" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "video_projects" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "filename" text NOT NULL,
  "object_path" text NOT NULL,
  "project_dir_id" text NOT NULL,
  "duration" integer NOT NULL DEFAULT 0,
  "width" integer NOT NULL DEFAULT 1920,
  "height" integer NOT NULL DEFAULT 1080,
  "thumbnail_url" text,
  "status" text NOT NULL DEFAULT 'uploaded'::text,
  "transcript_segments" jsonb,
  "overlays" jsonb,
  "chat_messages" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ad_concepts" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "awareness_stage" text NOT NULL,
  "concept_type" text NOT NULL,
  "funnel_position" text NOT NULL,
  "format" text NOT NULL,
  "headline" text NOT NULL,
  "hook" text NOT NULL,
  "body_copy" text NOT NULL,
  "cta" text NOT NULL,
  "angle" text NOT NULL,
  "target_avatar" text,
  "visual_direction" text,
  "funnel_type" text,
  "landing_page" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'generated'::text,
  "metadata" jsonb,
  "batch_id" text,
  "clerk_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ad_merger_clips" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "project_id" integer NOT NULL,
  "role" varchar(16) NOT NULL,
  "label" text NOT NULL,
  "source_object_path" text NOT NULL,
  "normalized_object_path" text,
  "original_name" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "status" varchar(16) NOT NULL DEFAULT 'processing'::character varying,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ad_merger_outputs" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "project_id" integer NOT NULL,
  "hook_clip_id" integer NOT NULL,
  "body_clip_id" integer NOT NULL,
  "cta_clip_id" integer NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending'::character varying,
  "object_path" text,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ad_merger_projects" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "clerk_id" varchar(255),
  "name" text NOT NULL,
  "aspect_ratio" varchar(16) NOT NULL DEFAULT '9:16'::character varying,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ad_research_ads" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "brand_id" integer NOT NULL,
  "fb_ad_id" text NOT NULL,
  "page_id" text NOT NULL,
  "page_name" text,
  "ad_body" text,
  "ad_title" text,
  "ad_description" text,
  "ad_link_caption" text,
  "cta_type" text,
  "start_date" timestamp with time zone,
  "end_date" timestamp with time zone,
  "platforms" jsonb,
  "display_format" text,
  "snapshot_url" text,
  "image_url" text,
  "video_url" text,
  "landing_page_url" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "board" text,
  "tags" jsonb,
  "ai_analysis" text,
  "saved_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ad_research_brands" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "page_id" text NOT NULL,
  "page_name" text NOT NULL,
  "page_url" text,
  "category" text,
  "notes" text,
  "last_scraped_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_concepts_user_id_portal_users_id_fk') THEN
    ALTER TABLE "ad_concepts" ADD CONSTRAINT "ad_concepts_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_merger_clips_user_id_portal_users_id_fk') THEN
    ALTER TABLE "ad_merger_clips" ADD CONSTRAINT "ad_merger_clips_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_merger_outputs_user_id_portal_users_id_fk') THEN
    ALTER TABLE "ad_merger_outputs" ADD CONSTRAINT "ad_merger_outputs_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_merger_projects_user_id_portal_users_id_fk') THEN
    ALTER TABLE "ad_merger_projects" ADD CONSTRAINT "ad_merger_projects_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_research_ads_user_id_portal_users_id_fk') THEN
    ALTER TABLE "ad_research_ads" ADD CONSTRAINT "ad_research_ads_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_research_brands_user_id_portal_users_id_fk') THEN
    ALTER TABLE "ad_research_brands" ADD CONSTRAINT "ad_research_brands_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_user_id_portal_users_id_fk') THEN
    ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_sources_user_id_portal_users_id_fk') THEN
    ALTER TABLE "brain_sources" ADD CONSTRAINT "brain_sources_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broll_assets_user_id_portal_users_id_fk') THEN
    ALTER TABLE "broll_assets" ADD CONSTRAINT "broll_assets_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_entries_user_id_portal_users_id_fk') THEN
    ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'camo_ads_user_id_portal_users_id_fk') THEN
    ALTER TABLE "camo_ads" ADD CONSTRAINT "camo_ads_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitor_channels_user_id_portal_users_id_fk') THEN
    ALTER TABLE "competitor_channels" ADD CONSTRAINT "competitor_channels_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitor_scraped_pages_user_id_portal_users_id_fk') THEN
    ALTER TABLE "competitor_scraped_pages" ADD CONSTRAINT "competitor_scraped_pages_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitor_sites_user_id_portal_users_id_fk') THEN
    ALTER TABLE "competitor_sites" ADD CONSTRAINT "competitor_sites_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitor_video_ideas_user_id_portal_users_id_fk') THEN
    ALTER TABLE "competitor_video_ideas" ADD CONSTRAINT "competitor_video_ideas_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitor_videos_user_id_portal_users_id_fk') THEN
    ALTER TABLE "competitor_videos" ADD CONSTRAINT "competitor_videos_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_creators_user_id_portal_users_id_fk') THEN
    ALTER TABLE "content_creators" ADD CONSTRAINT "content_creators_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'copywriting_guidelines_user_id_portal_users_id_fk') THEN
    ALTER TABLE "copywriting_guidelines" ADD CONSTRAINT "copywriting_guidelines_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_videos_user_id_portal_users_id_fk') THEN
    ALTER TABLE "creator_videos" ADD CONSTRAINT "creator_videos_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_profit_entries_user_id_portal_users_id_fk') THEN
    ALTER TABLE "daily_profit_entries" ADD CONSTRAINT "daily_profit_entries_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_sources_user_id_portal_users_id_fk') THEN
    ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editing_styles_user_id_portal_users_id_fk') THEN
    ALTER TABLE "editing_styles" ADD CONSTRAINT "editing_styles_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episodes_user_id_portal_users_id_fk') THEN
    ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'face_clones_user_id_portal_users_id_fk') THEN
    ALTER TABLE "face_clones" ADD CONSTRAINT "face_clones_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_ad_comments_user_id_portal_users_id_fk') THEN
    ALTER TABLE "fb_ad_comments" ADD CONSTRAINT "fb_ad_comments_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_bot_config_user_id_portal_users_id_fk') THEN
    ALTER TABLE "fb_bot_config" ADD CONSTRAINT "fb_bot_config_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_entries_user_id_portal_users_id_fk') THEN
    ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_entries_user_id_portal_users_id_fk') THEN
    ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learned_exemplars_user_id_portal_users_id_fk') THEN
    ALTER TABLE "learned_exemplars" ADD CONSTRAINT "learned_exemplars_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mt_conversations_user_id_portal_users_id_fk') THEN
    ALTER TABLE "mt_conversations" ADD CONSTRAINT "mt_conversations_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mt_messages_conversation_id_mt_conversations_id_fk') THEN
    ALTER TABLE "mt_messages" ADD CONSTRAINT "mt_messages_conversation_id_mt_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "mt_conversations"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mt_messages_user_id_portal_users_id_fk') THEN
    ALTER TABLE "mt_messages" ADD CONSTRAINT "mt_messages_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offers_user_id_portal_users_id_fk') THEN
    ALTER TABLE "offers" ADD CONSTRAINT "offers_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reddit_comments_user_id_portal_users_id_fk') THEN
    ALTER TABLE "reddit_comments" ADD CONSTRAINT "reddit_comments_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reddit_posts_user_id_portal_users_id_fk') THEN
    ALTER TABLE "reddit_posts" ADD CONSTRAINT "reddit_posts_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_docs_user_id_portal_users_id_fk') THEN
    ALTER TABLE "research_docs" ADD CONSTRAINT "research_docs_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'script_rewrites_user_id_portal_users_id_fk') THEN
    ALTER TABLE "script_rewrites" ADD CONSTRAINT "script_rewrites_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'short_form_scripts_user_id_portal_users_id_fk') THEN
    ALTER TABLE "short_form_scripts" ADD CONSTRAINT "short_form_scripts_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_comments_user_id_portal_users_id_fk') THEN
    ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_ad_assets_user_id_portal_users_id_fk') THEN
    ALTER TABLE "static_ad_assets" ADD CONSTRAINT "static_ad_assets_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_ad_brand_intelligence_user_id_portal_users_id_fk') THEN
    ALTER TABLE "static_ad_brand_intelligence" ADD CONSTRAINT "static_ad_brand_intelligence_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_ad_brand_kits_user_id_portal_users_id_fk') THEN
    ALTER TABLE "static_ad_brand_kits" ADD CONSTRAINT "static_ad_brand_kits_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_ad_generations_user_id_portal_users_id_fk') THEN
    ALTER TABLE "static_ad_generations" ADD CONSTRAINT "static_ad_generations_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_ad_offers_user_id_portal_users_id_fk') THEN
    ALTER TABLE "static_ad_offers" ADD CONSTRAINT "static_ad_offers_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'static_ad_templates_user_id_portal_users_id_fk') THEN
    ALTER TABLE "static_ad_templates" ADD CONSTRAINT "static_ad_templates_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_sequences_user_id_portal_users_id_fk') THEN
    ALTER TABLE "story_sequences" ADD CONSTRAINT "story_sequences_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_slides_sequence_id_story_sequences_id_fk') THEN
    ALTER TABLE "story_slides" ADD CONSTRAINT "story_slides_sequence_id_story_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "story_sequences"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_slides_user_id_portal_users_id_fk') THEN
    ALTER TABLE "story_slides" ADD CONSTRAINT "story_slides_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipe_file_items_user_id_portal_users_id_fk') THEN
    ALTER TABLE "swipe_file_items" ADD CONSTRAINT "swipe_file_items_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipe_file_sources_user_id_portal_users_id_fk') THEN
    ALTER TABLE "swipe_file_sources" ADD CONSTRAINT "swipe_file_sources_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thumbnail_projects_user_id_portal_users_id_fk') THEN
    ALTER TABLE "thumbnail_projects" ADD CONSTRAINT "thumbnail_projects_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thumbnail_templates_user_id_portal_users_id_fk') THEN
    ALTER TABLE "thumbnail_templates" ADD CONSTRAINT "thumbnail_templates_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_projects_user_id_portal_users_id_fk') THEN
    ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- indexes & unique indexes
CREATE INDEX IF NOT EXISTS ad_concepts_user_id_idx ON public.ad_concepts USING btree (user_id);
CREATE INDEX IF NOT EXISTS ad_merger_clips_project_idx ON public.ad_merger_clips USING btree (project_id);
CREATE INDEX IF NOT EXISTS ad_merger_clips_user_id_idx ON public.ad_merger_clips USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ad_merger_outputs_combo_unique ON public.ad_merger_outputs USING btree (project_id, hook_clip_id, body_clip_id, cta_clip_id);
CREATE INDEX IF NOT EXISTS ad_merger_outputs_project_idx ON public.ad_merger_outputs USING btree (project_id);
CREATE INDEX IF NOT EXISTS ad_merger_outputs_user_id_idx ON public.ad_merger_outputs USING btree (user_id);
CREATE INDEX IF NOT EXISTS ad_merger_projects_user_id_idx ON public.ad_merger_projects USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ad_research_ads_user_fb_ad_uq ON public.ad_research_ads USING btree (user_id, fb_ad_id);
CREATE INDEX IF NOT EXISTS ad_research_ads_user_id_idx ON public.ad_research_ads USING btree (user_id);
CREATE INDEX IF NOT EXISTS ad_research_brands_user_id_idx ON public.ad_research_brands USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ad_research_brands_user_page_uq ON public.ad_research_brands USING btree (user_id, page_id);
CREATE INDEX IF NOT EXISTS assets_user_id_idx ON public.assets USING btree (user_id);
CREATE INDEX IF NOT EXISTS brain_sources_clerk_idx ON public.brain_sources USING btree (clerk_id);
CREATE INDEX IF NOT EXISTS brain_sources_kind_idx ON public.brain_sources USING btree (kind);
CREATE INDEX IF NOT EXISTS brain_sources_user_id_idx ON public.brain_sources USING btree (user_id);
CREATE INDEX IF NOT EXISTS broll_assets_user_id_idx ON public.broll_assets USING btree (user_id);
CREATE INDEX IF NOT EXISTS calendar_entries_user_id_idx ON public.calendar_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS camo_ads_user_id_idx ON public.camo_ads USING btree (user_id);
CREATE INDEX IF NOT EXISTS competitor_channels_user_id_idx ON public.competitor_channels USING btree (user_id);
CREATE INDEX IF NOT EXISTS competitor_scraped_pages_user_id_idx ON public.competitor_scraped_pages USING btree (user_id);
CREATE INDEX IF NOT EXISTS competitor_sites_user_id_idx ON public.competitor_sites USING btree (user_id);
CREATE INDEX IF NOT EXISTS competitor_video_ideas_user_id_idx ON public.competitor_video_ideas USING btree (user_id);
CREATE INDEX IF NOT EXISTS competitor_videos_channel_idx ON public.competitor_videos USING btree (channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS competitor_videos_channel_video_uq ON public.competitor_videos USING btree (channel_id, video_id);
CREATE INDEX IF NOT EXISTS competitor_videos_outlier_idx ON public.competitor_videos USING btree (is_outlier);
CREATE INDEX IF NOT EXISTS competitor_videos_published_idx ON public.competitor_videos USING btree (published_at);
CREATE INDEX IF NOT EXISTS competitor_videos_user_id_idx ON public.competitor_videos USING btree (user_id);
CREATE INDEX IF NOT EXISTS content_creators_user_id_idx ON public.content_creators USING btree (user_id);
CREATE INDEX IF NOT EXISTS copywriting_guidelines_user_id_idx ON public.copywriting_guidelines USING btree (user_id);
CREATE INDEX IF NOT EXISTS creator_videos_user_id_idx ON public.creator_videos USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_profit_entries_user_date_unique ON public.daily_profit_entries USING btree (user_id, entry_date);
CREATE INDEX IF NOT EXISTS daily_profit_entries_user_id_idx ON public.daily_profit_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS data_sources_user_id_idx ON public.data_sources USING btree (user_id);
CREATE INDEX IF NOT EXISTS editing_styles_user_id_idx ON public.editing_styles USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS editing_styles_user_style_key_uq ON public.editing_styles USING btree (user_id, style_key);
CREATE INDEX IF NOT EXISTS episodes_user_id_idx ON public.episodes USING btree (user_id);
CREATE INDEX IF NOT EXISTS face_clones_user_id_idx ON public.face_clones USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS fb_ad_comments_user_fb_comment_uq ON public.fb_ad_comments USING btree (user_id, fb_comment_id);
CREATE INDEX IF NOT EXISTS fb_ad_comments_user_id_idx ON public.fb_ad_comments USING btree (user_id);
CREATE INDEX IF NOT EXISTS fb_bot_config_user_id_idx ON public.fb_bot_config USING btree (user_id);
CREATE INDEX IF NOT EXISTS financial_entries_user_id_idx ON public.financial_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS kpi_entries_user_id_idx ON public.kpi_entries USING btree (user_id);
CREATE INDEX IF NOT EXISTS learned_exemplars_tool_kind_idx ON public.learned_exemplars USING btree (tool, kind);
CREATE INDEX IF NOT EXISTS learned_exemplars_user_id_idx ON public.learned_exemplars USING btree (user_id);
CREATE INDEX IF NOT EXISTS mt_conversations_user_id_idx ON public.mt_conversations USING btree (user_id);
CREATE INDEX IF NOT EXISTS mt_messages_user_id_idx ON public.mt_messages USING btree (user_id);
CREATE INDEX IF NOT EXISTS offers_user_id_idx ON public.offers USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS reddit_comments_comment_id_offer_id_idx ON public.reddit_comments USING btree (comment_id, offer_id);
CREATE INDEX IF NOT EXISTS reddit_comments_user_id_idx ON public.reddit_comments USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS reddit_posts_post_id_offer_id_idx ON public.reddit_posts USING btree (post_id, offer_id);
CREATE INDEX IF NOT EXISTS reddit_posts_user_id_idx ON public.reddit_posts USING btree (user_id);
CREATE INDEX IF NOT EXISTS research_docs_user_id_idx ON public.research_docs USING btree (user_id);
CREATE INDEX IF NOT EXISTS script_rewrites_user_id_idx ON public.script_rewrites USING btree (user_id);
CREATE INDEX IF NOT EXISTS short_form_scripts_clerk_idx ON public.short_form_scripts USING btree (clerk_id);
CREATE INDEX IF NOT EXISTS short_form_scripts_user_id_idx ON public.short_form_scripts USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_comments_comment_id_platform_offer_id_idx ON public.social_comments USING btree (comment_id, platform, offer_id);
CREATE INDEX IF NOT EXISTS social_comments_user_id_idx ON public.social_comments USING btree (user_id);
CREATE INDEX IF NOT EXISTS static_ad_assets_user_id_idx ON public.static_ad_assets USING btree (user_id);
CREATE INDEX IF NOT EXISTS static_ad_brand_intelligence_user_id_idx ON public.static_ad_brand_intelligence USING btree (user_id);
CREATE INDEX IF NOT EXISTS static_ad_brand_kits_user_id_idx ON public.static_ad_brand_kits USING btree (user_id);
CREATE INDEX IF NOT EXISTS static_ad_generations_user_id_idx ON public.static_ad_generations USING btree (user_id);
CREATE INDEX IF NOT EXISTS static_ad_offers_user_id_idx ON public.static_ad_offers USING btree (user_id);
CREATE INDEX IF NOT EXISTS static_ad_templates_user_id_idx ON public.static_ad_templates USING btree (user_id);
CREATE INDEX IF NOT EXISTS story_sequences_user_id_idx ON public.story_sequences USING btree (user_id);
CREATE INDEX IF NOT EXISTS story_slides_user_id_idx ON public.story_slides USING btree (user_id);
CREATE INDEX IF NOT EXISTS swipe_file_items_user_id_idx ON public.swipe_file_items USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS swipe_file_sources_user_clerk_uq ON public.swipe_file_sources USING btree (user_id, clerk_id);
CREATE INDEX IF NOT EXISTS swipe_file_sources_user_id_idx ON public.swipe_file_sources USING btree (user_id);
CREATE INDEX IF NOT EXISTS thumbnail_projects_user_id_idx ON public.thumbnail_projects USING btree (user_id);
CREATE INDEX IF NOT EXISTS thumbnail_templates_user_id_idx ON public.thumbnail_templates USING btree (user_id);
CREATE INDEX IF NOT EXISTS video_projects_user_id_idx ON public.video_projects USING btree (user_id);

COMMIT;
