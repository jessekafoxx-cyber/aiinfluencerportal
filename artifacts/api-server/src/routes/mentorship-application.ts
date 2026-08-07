import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  submitEliteMentorshipApplication,
  eliteMentorshipBookingUrl,
} from "../lib/ghl-sync";

const router: IRouter = Router();

const ApplicationSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(3).max(40),
  currentSituation: z.string().trim().max(300).optional().default(""),
  monthlyIncome: z.string().trim().max(300).optional().default(""),
  targetIncome: z.string().trim().max(300).optional().default(""),
  investmentWillingness: z.string().trim().max(500).optional().default(""),
  twelveMonthVision: z.string().trim().max(5000).optional().default(""),
});

/**
 * Public endpoint backing the custom Elite 1-1 Mentorship application form
 * (the in-app Typeform replacement). Mirrors the applicant into GoHighLevel
 * (contact + `elite-mentorship-applicant` tag + answer note) and returns the
 * booking-calendar URL for the final step.
 *
 * GHL mirroring is best-effort and never blocks the response - a flaky GHL
 * must never stop a qualified applicant from reaching the booking calendar.
 */
router.post("/mentorship-application", async (req, res) => {
  const parsed = ApplicationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "invalid_application" });
  }

  try {
    await submitEliteMentorshipApplication(parsed.data);
  } catch (err) {
    req.log.warn({ err }, "[mentorship-application] submit threw");
  }

  return res.json({ ok: true, bookingUrl: eliteMentorshipBookingUrl() });
});

export default router;
