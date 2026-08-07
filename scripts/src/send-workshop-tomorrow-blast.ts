// One-shot: send the "first live workshop with Greg is coming up"
// announcement to every current Platinum Club member.
//
// Picks the next upcoming workshop (earliest startsAt in the future)
// and sends an out-of-band notice that points at the portal Workshops
// tab. Does NOT touch reminder_*_sent_at idempotency columns - the
// regular 24h + 15m schedulers still fire on their own windows.
//
// Run: pnpm --filter @workspace/scripts run blast:workshop-tomorrow
//
// Sender: hello@users.room30.ai (replyTo hello@room30.ai). Verified
// Resend subdomain per replit.md.

import { sendImmediateUpcomingWorkshopBlast } from '../../artifacts/api-server/src/lib/workshop-reminder-scheduler';

async function main(): Promise<void> {
  // Optional positional args = email addresses to target. Useful for
  // re-running just the buyers a previous run failed on (Resend
  // rate-limit retries, etc) without re-blasting the whole list.
  const onlyEmails = process.argv.slice(2).filter((a) => a.includes('@'));
  console.log(
    onlyEmails.length > 0
      ? `[blast] re-sending to ${onlyEmails.length} targeted addresses: ${onlyEmails.join(', ')}`
      : '[blast] looking up next upcoming workshop...',
  );
  const result = await sendImmediateUpcomingWorkshopBlast(
    onlyEmails.length > 0 ? { onlyEmails } : undefined,
  );
  if ('error' in result) {
    console.error(`[blast] aborted: ${result.error}`);
    process.exit(1);
  }
  console.log('[blast] complete:', {
    workshopId: result.workshopId,
    workshopTitle: result.workshopTitle,
    startsAt: result.startsAt,
    recipients: result.recipients,
    sent: result.sent,
    failed: result.failed,
  });
  if (result.failed > 0) {
    console.warn(`[blast] ${result.failed} sends failed - check email_logs for details`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[blast] threw:', err);
  process.exit(1);
});
