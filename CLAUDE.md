# CLP Broker Onboarding Form

Survey-style onboarding intake for brokers/loan officers joining the dscrbroker.com
lead round-robin. CRE Loan Pro branded. Sent as a link AFTER the broker is already
sold on a call; this is pure data collection, no pricing, no terms, no TCPA (B2B
partner intake, not consumer lead capture).

Built 2026-07-28. First draft, not yet deployed.

## Stack

Astro 5 + React 19 island + Tailwind v4 + `@astrojs/vercel`. Static output, only
`/api/onboard` runs serverless. Same pattern as `clients/dscr-funnel-template/`.

- `npm run dev`: port 4321
- `npm run build`: must pass before any commit
- `node tools/qa.mjs [pass-name]`: full e2e walk (desktop + mobile), screenshots every
  key step to `tools/shots/`, verifies +1 phone-strip formatting, submits for real.

## The flow

Welcome screen -> 23 questions, one per screen, 5 sections -> success screen with a
3-to-5-day timeline. Auto-advance on single-choice steps, Enter advances text steps,
Back always available, progress bar with section labels.

1. **You + your license:** name, company, personal NMLS, company NMLS (optional),
   states licensed (50 + DC grid), states they WANT leads from (all-or-pick;
   pick list is filtered to licensed states at submit).
2. **Your profile (added v2, 2026-07-28):** company logo upload (optional, skippable),
   headshot upload (optional), reviews link (optional, https:// auto-prepended).
   Big rasters are downscaled client-side (max 2000px JPEG) to stay under the
   serverless body limit; SVGs pass through untouched.
3. **Lead delivery:** cell for delivery, email for delivery, channels (text/email/CRM,
   multi), CRM (chips + Other free text), first-contact speed commitment.
4. **Capacity + products:** leads/mo wanted (round-robin weight), DSCR products
   (multi), property types (multi), loan min/max, dealbreakers (optional).
5. **Billing:** entity name for invoicing, billing email (same-as-lead-email
   quick-fill), payment method, final notes (optional).

v2 language pass (2026-07-28, Tanner's call): every question title/helper made
professionally clear while keeping the peer register. Single typeface site-wide
(Hanken Grotesk); Fragment Mono removed as too robotic.

## Server route: /api/onboard

Accepts multipart (payload JSON + logo/headshot files). Files are stored in Vercel
Blob and only their public URLs travel onward, so the Zap and the emails always see
plain JSON. ONE webhook per submission (standing rule, no partials). Honeypot
`website` field gets bots a silent 200. Server stamps `receivedAt`, `submitIp`,
`submitUserAgent`.

**The work-order prompt (added 2026-07-28):** every submission generates a
`claudePrompt` field, a self-contained "set this broker up on the dscrbroker.com
round-robin" prompt with all answers inline plus tasks (read the two CLAUDE.mds,
verify NMLS, build profile + routing, plan before going live, prep test lead).
It rides in the webhook payload (so a Zap-side email can carry it) AND renders as
a copyable block in the Resend notification email. Tanner pastes it into a future
Claude Code session and the build-out starts with zero retyping. Test harness:
`node tools/webhook-catcher.mjs` fakes the Zap on localhost:5321 and dumps what it
receives to `tools/webhook-received.json`.

Env vars (copy `env.example` to `.env`, or set in Vercel):

- `LEAD_WEBHOOK_URL`: Zapier catch hook, NEVER a GHL inbound webhook. Tanner maps
  the Zap into GHL himself.
- `BLOB_READ_WRITE_TOKEN`: auto-set when a Blob store is attached to the Vercel
  project (Storage tab -> Create -> Blob). Without it, uploads are noted in the
  payload text but not stored.
- `RESEND_API_KEY` + `FROM_EMAIL`: enables both emails via Resend (notification to
  Tanner + "you're in, 3-5 business days" confirmation to the broker). FROM_EMAIL
  must be on a domain verified in Resend. If unset, emails are skipped and the
  success screen does NOT promise an email (the API returns `emailSent` and the UI
  adapts; golden-rules honesty floor: never promise an email we cannot send).
  Alternative: leave Resend unset and send both emails from the Zap instead.
- `NOTIFY_EMAIL`: defaults to tanner@creloanpro.com.

## Launch checklist

- [ ] Create the Zap (catch hook -> GHL), paste URL into `LEAD_WEBHOOK_URL`
- [ ] Attach a Blob store to the Vercel project (one click) so logo/headshot uploads store
- [ ] Decide email path: Resend (set 3 env vars) or Zap-side emails
- [ ] `vercel project ls` FIRST, then link/deploy (duplicate-project gotcha)
- [ ] Pick the URL (suggestion: onboard.creloanpro.com or creloanpro.com/onboard)
- [ ] Send Tanner's own cell through it once as a live test

## Design

Clean fintech-professional with CLP swagger in the microcopy (these brokers are
already sold and mostly friends; the form talks like it). Light mode, layered
shadows, engineering-grid backdrop, Hanken Grotesk + Fragment Mono, blue #1e5eff on
ink #0a1a33. Motion kept lean on purpose (utility page, not a funnel): step
transitions, progress bar, check-draw on success, all gated by
`prefers-reduced-motion`.

## Lessons Learned

- (none yet)
