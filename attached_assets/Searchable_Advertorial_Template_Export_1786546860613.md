# Searchable Advertorial Template Export

`advertorial_ad_templates_searchable.csv` keeps the original `title`, `canva_link`, and `image` fields, then adds structured categories based on the visible creative and title.

| Field | Use for filtering/search |
|---|---|
| `creative_format` | The ad’s core editorial format, such as `blog_article`, `news_report`, `expert_doctor`, `product_review`, `comparison`, `testimonial`, `before_after`, or `sale_offer`. |
| `primary_hook` | The principal persuasion angle: `curiosity`, `problem_agitation`, `outcome_benefit`, `authority`, `proof`, `urgency`, `question`, or `negative_news`. |
| `subject` | The evident market/topic: `health_wellness`, `beauty_skincare`, `fitness_weight_loss`, `finance_wealth`, `pets`, `software_apps`, `home_lifestyle`, and others. |
| `visual_style` | The appearance of the creative, including `article_editorial`, `news_media`, `screenshot_ui`, `user_generated`, `product_hero`, `text_graphic`, `image_led`, and `before_after`. |
| `search_keywords` | Pipe-separated terms for broad free-text search; search the entire field or split on ` | ` in your application. |
| `search_summary` | A short natural-language description for search results and hover previews. |
| `classification_confidence` | A 0–1 indicator of how clearly the creative matched its assigned tags. |

For an app search box, search a normalized combination of `title`, `search_keywords`, and `search_summary`. For filter controls, use `creative_format`, `primary_hook`, `subject`, and `visual_style` as exact facet values.

The categories are descriptive search aids generated from the available template title and preview image, not claims about the advertiser or product.
