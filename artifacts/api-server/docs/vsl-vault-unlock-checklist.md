# VSL Vault → VSL Masterclass Unlock — Staged Manual Verification Checklist

This checklist exercises the live purchase path so the VSL Masterclass page (`/portal/vsl-masterclass`) actually unlocks for a paying buyer. Run it whenever the order-bump-1 / charge-addon code path or the Whop webhook handler is touched.

## Background — which webhook event causes the unlock

The canonical unlock writes `orders.bump1_paid = true` for the buyer's order row. There are two redundant paths that both flip that flag:

1. **Synchronous (foreground)** — `POST /api/portal/charge-addon` in `artifacts/api-server/src/routes/portal.ts`. After `whopClient.chargeUser` returns success the route immediately runs `UPDATE orders SET bump1_paid = true ...` so the buyer sees the unlock without waiting for any webhook.
2. **Webhook safety net** — Whop fires `payment.succeeded` (and shortly after `membership.went_valid`) to `POST /api/whop-webhook`. The handler at `artifacts/api-server/src/whopWebhookHandlers.ts` reads `metadata.orderId` (which the charge-addon route now passes) and calls `markBumpOrUpsellPaid`, which idempotently flips the same flag.

If a paying buyer reports the masterclass is still locked, check both paths. Either alone is sufficient to unlock the page; if both fail, the bug is in `/portal/charge-addon` (route returned 500 before the synchronous update) or in webhook delivery / signature validation.

## A. Locked-state verification (preconditions)

1. Sign into the portal as a buyer whose `orders` row has `main_product_paid = true`, `bump1_paid = false`, and a non-null `whop_user_id`.
2. Open the left sidebar. Confirm:
   - "VSL Templates Pack" entry shows the lock icon and the "$37" price tag.
   - "VSL Masterclass" sub-entry directly underneath shows the lock icon, no price.
3. Navigate to `/portal/vsl-masterclass`. Confirm:
   - The "VSL Order Bump Required" gate card is visible.
   - No chapter content renders.

## B. Live charge — happy path

4. From the sidebar, click the locked "VSL Templates Pack" entry. The buy modal should appear with the $37 price and a working "Buy" button.
5. Click "Buy". Watch the server log for `[portal] /portal/charge-addon` activity and the resulting Whop request. Expect a 200 response with `{ success: true, receiptId, membershipId }`.
6. In the database, confirm the buyer's order row now has `bump1_paid = true` (the synchronous update has run).
7. The toast should read "Purchase complete" and the user should be redirected to `/portal/vsl-templates` after ~250ms.
8. Navigate to `/portal/vsl-masterclass` and confirm:
   - The "VSL Order Bump Required" gate is GONE.
   - The sticky "Chapters" table-of-contents renders on the left.
   - At least one "Chapter N" section renders on the right.
9. Re-check the sidebar:
   - "VSL Templates Pack" now shows the green checkmark and no price.
   - "VSL Masterclass" sub-entry now shows the BookOpen icon and no lock.

## C. Webhook safety net — verify it also unlocks if the foreground update is skipped

10. Reset the order row: `UPDATE orders SET bump1_paid = false WHERE id = '<order_id>';` (so we can confirm the webhook alone re-unlocks).
11. In the Whop dashboard, replay the `payment.succeeded` event for that charge (the metadata must include `orderId = <order_id>` and `productSlug = "order-bump-1"`).
12. Confirm `bump1_paid` is `true` again in the database.
13. Hard-reload `/portal/vsl-masterclass` and confirm the unlocked content renders.

## D. Idempotency

14. Click "Buy" on the VSL Templates Pack a second time after the unlock. Expect a 200 response with `{ success: true, alreadyCharged: true }` and **no** second Whop charge (the route short-circuits on `bump1_paid = true`).
15. Confirm in the Whop dashboard that no duplicate membership / charge was created.

## Failure-mode notes

- If step 5 returns 400 with "We could not find a saved Whop account", the user's order row is missing `whop_user_id`. Investigate the funnel webhook that originally created the order.
- If step 6 fails (flag not set despite a 200 response), check the api-server logs for the `await db.update(ordersTable)...` write right after `whopClient.chargeUser` in `/portal/charge-addon`.
- If step 12 fails, check `/api/whop-webhook` logs for either a signature error or a "Whop webhook with no orderId in metadata" log line. The latter means the Whop dashboard event no longer carries `metadata.orderId`, which is the exact regression the order-bump-1 portal path was vulnerable to before it started threading `orderId` through `chargeUser`.
