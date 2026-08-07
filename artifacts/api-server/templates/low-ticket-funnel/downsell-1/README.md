# downsell-1

Standalone React + Vite + TypeScript build of the **/downsell-1** page from
the AI Influencer sales funnel. Pixel-identical to the source - same fonts,
colors, copy, spacing, breakpoints.

## Run locally
```
npm install
npm run dev
```
The page renders at `/downsell-1` (the catch-all also renders it at `/`).

## Files
- `src/App.tsx` - slim router with just this page (regenerated for the split)
- `src/main.tsx` - entry point (regenerated for the split)
- `src/pages/downsell-1.tsx` - the page itself (unmodified from source)
- `src/components/` - only the components this page actually imports
- `public/` - only the images this page actually uses

## Import into another Replit project
Copy this folder in, then tell that project's agent:

> Create a React + Vite TypeScript artifact and overwrite its scaffold
> with the contents of this folder. Do not refactor, do not swap any
> asset, do not change any color, font, copy, or spacing. After install,
> verify the page renders pixel-identically at `/downsell-1` on both
> 1280px desktop and 375px mobile.
