# Zap Wiring: CLP Broker Onboarding -> GHL

The Zap is a 2-step build (3 if you want the email from the Zap instead of
Resend). Total hands-on time once the sample payload is caught: ~5 minutes,
because every field below shows up pre-named in Zapier's mapping dropdowns.

## The build order (who does what)

1. **Tanner (60 seconds):** In Zapier: Create Zap -> Trigger: "Webhooks by
   Zapier" -> Event: "Catch Hook" -> copy the hook URL -> paste it to Claude
   (or straight into Vercel as `LEAD_WEBHOOK_URL`).
2. **Claude:** sets `LEAD_WEBHOOK_URL`, fires a fully populated test submission
   (every one of the ~34 fields filled, logo included). Zapier catches it as
   the sample record.
3. **Tanner (~5 min):** back in the Zap, click "Test trigger" (the sample is
   waiting), add the GHL action step, and point-and-click the mapping below.
   Every field name in the left column appears in Zapier's dropdown exactly as
   written. Zapier's AI Copilot can also do the mapping if you paste it this
   table.

## Zap structure

- **Step 1, Trigger:** Webhooks by Zapier -> Catch Hook
- **Step 2, Action:** GoHighLevel/LeadConnector -> Add/Update Contact
- **Step 3 (optional), Action:** GoHighLevel -> Add Note (or Task) on that
  contact, body = `claudePrompt`. Recommended: a note survives on the contact
  forever, so the work-order prompt is always one click away in GHL.
- **Step 4 (only if skipping Resend):** Email by Zapier -> to
  tanner@creloanpro.com, subject `New broker onboarded: {{fullName}}`, body =
  the fields you care about + `{{claudePrompt}}`.

## Field map (webhook payload -> GHL)

### Contact standard fields

| Payload field | GHL field |
|---|---|
| firstName | First Name |
| lastName | Last Name |
| leadEmail | Email |
| leadPhone | Phone |
| company | Company Name |

Tag the contact `broker-onboarding` in the same action step.

### Custom fields (create once in GHL, Settings -> Custom Fields)

| Payload field | Suggested GHL custom field | Type |
|---|---|---|
| nmls | Broker NMLS | Text |
| companyNmls | Company NMLS | Text |
| statesLicensed | States Licensed | Text |
| statesWanted | Lead States | Text |
| logoUrl | Logo URL | Text |
| headshotUrl | Headshot URL | Text |
| reviewsUrl | Reviews URL | Text |
| deliveryChannels | Delivery Channels | Text |
| crm | Broker CRM | Text |
| responseSpeed | Response Commitment | Text |
| monthlyLeads | Monthly Lead Target | Text |
| products | DSCR Products | Multi Line |
| propertyTypes | Property Types | Text |
| loanRange | Loan Range | Text |
| dealbreakers | Dealbreakers | Multi Line |
| billingEntity | Billing Entity | Text |
| billingEmail | Billing Email | Text |
| paymentMethod | Payment Method | Text |
| notes | Onboarding Notes | Multi Line |
| claudePrompt | Claude Work Order | **Multi Line (required, it truncates in a Text field)** |

### Fields you can skip mapping (metadata, already in the payload if ever needed)

`source`, `partial`, `fullName` (first+last cover it), `loanMin`, `loanMax`
(loanRange covers both), `secondsToComplete`, `receivedAt`, `submitIp`,
`submitUserAgent`, `website` (honeypot, always empty).

## Broker confirmation email (2nd Email action in the Zap)

Action: Email by Zapier (or GHL email if you prefer it from your sending domain).
Map the fields from the Step 1 catch hook where you see {{...}}.

- **To:** {{leadEmail}}
- **From name:** Tanner at CRE Loan Pro
- **Reply-to:** tanner@creloanpro.com
- **Subject:** You're in. Here's what happens next.

Body:

> Got everything, {{firstName}}.
>
> Your onboarding is locked in and your setup starts now. Give us 3 to 5
> business days to verify your licensing, build your profile, and wire up
> your lead delivery.
>
> Here's the play from here:
>
> Day 1: We verify your NMLS and state licensing.
> Days 2-3: We build your profile and wire your delivery channels.
> Days 4-5: You get a test lead to confirm everything fires.
> Then you're live in the rotation for {{statesWanted}}. Real leads, real time.
>
> If anything changes before then, licensing, phone number, capacity, just
> reply to this email or text me.
>
> Talk soon,
> Tanner
> CRE Loan Pro

## Re-firing the sample

Any time the Zap needs a fresh sample record, ask Claude to "fire the
onboarding test payload at the Zap." The full Marcus Delgado test submission
goes through the real form API (multipart, logo included), so what Zapier
catches is byte-identical to a real broker submission.
