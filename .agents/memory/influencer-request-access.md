---
name: Influencer request access
description: Product rule for generation balances and purchase prompts.
---

Members with remaining included, purchased, or granted influencer generations must be able to request another influencer before being asked to buy more. An existing queued request must not itself force a purchase.

**Why:** The user explicitly requires available generations to remain usable; purchase-first entry points can falsely imply a member has exhausted their entitlement.

**How to apply:** Base request and exhaustion UI on the authoritative generation balance. If fetching that balance fails, show a retry state rather than assuming no credits. Optional top-ups may remain available.
