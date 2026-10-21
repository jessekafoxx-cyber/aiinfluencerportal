---
name: Email recovery safety
description: Separate delivery repairs from targeted recovery of historical failed messages.
---

Fixing the sender configuration does not authorize a bulk replay of historical failed emails. Recover old messages through a targeted, explicitly approved resend, preserving successful-send deduplication.

**Why:** The production failure history included both purchase access emails and older reminders. Replaying the whole backlog could deliver obsolete messages or unwanted reminders to customers.

**How to apply:** When repairing purchase email delivery or adding retry automation, distinguish current retryable purchase events from historical recovery. Do not send the historical backlog as a side effect of a configuration change or deployment.
