# sales-page

> ## ⚠️  CRITICAL — PROOF & PRESS IMAGES ARE NOT INCLUDED
>
> This template ships with **blank dashed placeholder slots** for:
> - The **proof banner** under the VSL
> - The **"Prove To Me This Makes Money"** screenshot wall (8 slots)
> - The **"As Seen On"** press logo strip (8 slots)
> - The **founder photo / collage**
>
> The original images (Stripe / Hyros screenshots and press logos)
> belong to Gregory Cooke and are **deliberately not bundled**.
> You must supply your **own** screenshots, logos, and photos —
> never use anyone else's. Drop your assets in `public/` and replace
> each placeholder slot in `src/pages/sales.tsx`.
>
> A red warning banner is rendered on the page until you set
> `PLACEHOLDERS_REPLACED = true` near the top of `src/pages/sales.tsx`.

Standalone React + Vite + TypeScript build of the **/sales-a** page from
the AI Influencer sales funnel. Pixel-identical to the source - same fonts,
colors, copy, spacing, breakpoints.

## Run locally
```
npm install
npm run dev
```
The page renders at `/sales-a` (the catch-all also renders it at `/`).

## Files
- `src/App.tsx` - slim router with just this page (regenerated for the split)
- `src/main.tsx` - entry point (regenerated for the split)
- `src/pages/sales.tsx` - the page itself (unmodified from source)
- `src/components/` - only the components this page actually imports
- `public/` - only the images this page actually uses

## Import into another Replit project
Copy this folder in, then tell that project's agent:

> Create a React + Vite TypeScript artifact and overwrite its scaffold
> with the contents of this folder. Do not refactor, do not swap any
> asset, do not change any color, font, copy, or spacing. After install,
> verify the page renders pixel-identically at `/sales-a` on both
> 1280px desktop and 375px mobile.
