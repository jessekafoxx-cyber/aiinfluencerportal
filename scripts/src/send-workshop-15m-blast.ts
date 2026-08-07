// One-shot: force the "starts in 15 minutes - Zoom link inside" blast
// to every current Platinum Club member RIGHT NOW. Used when the
// regular 5-min scheduler tick hasn't fired yet but the workshop is
// imminent.
//
// Atomically claims reminder_15m_sent_at so the scheduler won't
// double-send. Safe to re-run (returns alreadySent=true on replay).
//
// Run: pnpm --filter @workspace/scripts run blast:workshop-15m
//
// Optional positional args: email addresses to target (re-runs for a
// subset only).

import { sendImmediate15mReminder } from '../../artifacts/api-server/src/lib/workshop-reminder-scheduler';

async function main(): Promise<void> {
  const onlyEmails = process.argv.slice(2).filter((a) => a.includes('@'));
  console.log(
    onlyEmails.length > 0
      ? `[blast] targeting ${onlyEmails.length} addresses: ${onlyEmails.join(', ')}`
      : '[blast] firing 15m reminder for next upcoming workshop...',
  );
  const result = await sendImmediate15mReminder(
    onlyEmails.length > 0 ? { onlyEmails } : undefined,
  );
  if ('error' in result) {
    console.error(`[blast] aborted: ${result.error}`);
    process.exit(1);
  }
  console.log('[blast] complete:', result);
  if ('alreadySent' in result && result.alreadySent) {
    console.warn('[blast] 15m reminder was already sent by the scheduler - nothing to do');
  }
  if (result.failed > 0) {
    console.warn(`[blast] ${result.failed} sends failed - check email_logs for details`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[blast] threw:', err);
  process.exit(1);
});
