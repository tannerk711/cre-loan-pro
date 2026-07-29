import type { APIRoute } from 'astro';
import { put } from '@vercel/blob';

export const prerender = false;

// Broker onboarding intake. Accepts multipart (payload JSON + logo/headshot
// files). Files go to Vercel Blob and only their URLs travel onward, so the
// Zap and the emails always see plain JSON. One webhook per submission
// (standing rule), then two optional emails via Resend: a notification to
// Tanner and a confirmation to the broker.
// Env vars (Vercel project settings / .env):
//   LEAD_WEBHOOK_URL       - Zapier catch hook (never a GHL inbound webhook)
//   BLOB_READ_WRITE_TOKEN  - auto-set when a Blob store is attached in Vercel;
//                            without it, uploads are noted but not stored
//   RESEND_API_KEY         - enables both emails; skipped gracefully if absent
//   FROM_EMAIL             - verified Resend sender, e.g. "Tanner <tanner@creloanpro.com>"
//   NOTIFY_EMAIL           - defaults to tanner@creloanpro.com

const FIELD_LABELS: Array<[string, string]> = [
  ['fullName', 'Name'],
  ['company', 'Company'],
  ['nmls', 'NMLS'],
  ['companyNmls', 'Company NMLS'],
  ['statesLicensed', 'Licensed states'],
  ['statesWanted', 'Wants leads from'],
  ['logoUrl', 'Logo'],
  ['headshotUrl', 'Headshot'],
  ['reviewsUrl', 'Reviews link'],
  ['leadPhone', 'Lead phone'],
  ['leadEmail', 'Lead email'],
  ['deliveryChannels', 'Delivery channels'],
  ['crm', 'CRM'],
  ['responseSpeed', 'First-contact speed'],
  ['monthlyLeads', 'Leads/mo wanted'],
  ['products', 'Products'],
  ['propertyTypes', 'Property types'],
  ['loanRange', 'Loan range'],
  ['dealbreakers', 'Dealbreakers'],
  ['billingEntity', 'Billing entity'],
  ['billingEmail', 'Billing email'],
  ['paymentMethod', 'Payment method'],
  ['notes', 'Notes'],
  ['secondsToComplete', 'Seconds to complete'],
];

export const POST: APIRoute = async ({ request }) => {
  let data: Record<string, unknown>;
  const uploads: Array<{ field: 'logoUrl' | 'headshotUrl'; kind: string; file: File }> = [];
  try {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const fd = await request.formData();
      data = JSON.parse(String(fd.get('payload') ?? '{}'));
      const logo = fd.get('logo');
      const headshot = fd.get('headshot');
      if (logo instanceof File && logo.size > 0) uploads.push({ field: 'logoUrl', kind: 'logo', file: logo });
      if (headshot instanceof File && headshot.size > 0) uploads.push({ field: 'headshotUrl', kind: 'headshot', file: headshot });
    } else {
      data = await request.json();
    }
  } catch {
    return json({ ok: false, error: 'bad payload' }, 400);
  }

  // honeypot filled means bot. Return success so it learns nothing.
  if (typeof data.website === 'string' && data.website.trim() !== '') {
    return json({ ok: true, emailSent: false }, 200);
  }
  delete data.website;

  // minimal server-side sanity: the fields the round-robin cannot run without
  for (const req of ['fullName', 'nmls', 'leadPhone', 'leadEmail', 'statesLicensed']) {
    if (typeof data[req] !== 'string' || (data[req] as string).trim() === '') {
      return json({ ok: false, error: `missing ${req}` }, 400);
    }
  }

  // store files in Vercel Blob; only URLs travel onward
  const blobToken = import.meta.env.BLOB_READ_WRITE_TOKEN;
  for (const u of uploads) {
    if (!blobToken) {
      data[u.field] = `received "${u.file.name}" but not stored (set BLOB_READ_WRITE_TOKEN)`;
      continue;
    }
    try {
      const slug = String(data.fullName ?? 'broker').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const blob = await put(`onboarding/${slug}-${u.kind}-${u.file.name}`, u.file, {
        access: 'public',
        token: blobToken,
      });
      data[u.field] = blob.url;
    } catch (e) {
      console.error(`[onboard] blob upload failed (${u.kind}):`, e);
      data[u.field] = `upload failed for "${u.file.name}"; ask the broker to text it over`;
    }
  }

  // ready-to-paste Claude Code prompt so Tanner can hand the setup work to a
  // future session without retyping anything. Travels in the webhook payload
  // too, so a Zap-side email can carry it if Resend is ever turned off.
  data.claudePrompt = buildClaudePrompt(data);

  const headers = request.headers;
  data.receivedAt = new Date().toISOString();
  data.submitIp =
    headers.get('x-vercel-forwarded-for') ??
    headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    null;
  data.submitUserAgent = headers.get('user-agent') ?? null;

  // 1) the one webhook (Zapier catch hook -> Tanner maps into GHL)
  const webhook = import.meta.env.LEAD_WEBHOOK_URL;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return json({ ok: false, error: `webhook ${res.status}` }, 502);
    } catch {
      return json({ ok: false, error: 'webhook unreachable' }, 502);
    }
  } else {
    console.log('[onboard] LEAD_WEBHOOK_URL not set; payload:', JSON.stringify(data));
  }

  // 2) emails, best-effort. A mail failure never fails the submission.
  let emailSent = false;
  const resendKey = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.FROM_EMAIL;
  if (resendKey && from) {
    const notify = import.meta.env.NOTIFY_EMAIL || 'tanner@creloanpro.com';
    const summary = FIELD_LABELS
      .filter(([k]) => data[k] != null && data[k] !== '')
      .map(([k, label]) => row(label, String(data[k])))
      .join('');

    const notifyBody = {
      from,
      to: [notify],
      subject: `New broker onboarded: ${data.fullName} (${data.company ?? 'no company'})`,
      html: wrap(`
        <h2 style="margin:0 0 16px;font-size:20px;color:#0a1a33;">New broker in the pipeline</h2>
        <table style="border-collapse:collapse;width:100%;">${summary}</table>
        <h3 style="margin:24px 0 8px;font-size:15px;color:#0a1a33;">Paste this into Claude Code to build them out</h3>
        <pre style="margin:0;padding:14px 16px;background:#f5f7fb;border:1px solid #e3e9f2;border-radius:8px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.55;color:#0a1a33;white-space:pre-wrap;word-break:break-word;">${escapeHtml(String(data.claudePrompt))}</pre>
        <p style="margin:20px 0 0;font-size:13px;color:#71809a;">Wire the routing, send the test lead, flip them live.</p>
      `),
    };

    const brokerBody = {
      from,
      to: [String(data.leadEmail)],
      subject: "You're in. Here's what happens next.",
      html: wrap(`
        <h2 style="margin:0 0 16px;font-size:20px;color:#0a1a33;">Got everything, ${escapeHtml(String(data.firstName ?? '').trim() || 'my friend')}.</h2>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3c4c66;">
          Your onboarding is locked in and your routing build starts now. Give us 3 to 5 business days
          to verify your licensing, wire up your delivery channels, and fire you a test lead.
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3c4c66;">
          Once the test lead confirms everything fires, you're live in the rotation and real leads
          start hitting your phone.
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3c4c66;">
          Anything changes on your end before then, licensing, phone number, capacity, just reply
          to this email or text me.
        </p>
        <p style="margin:24px 0 0;font-size:15px;color:#0a1a33;font-weight:700;">Tanner<br>
        <span style="font-weight:400;color:#71809a;font-size:13px;">CRE Loan Pro</span></p>
      `),
    };

    const send = (body: unknown) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    try {
      const [n, b] = await Promise.all([send(notifyBody), send(brokerBody)]);
      emailSent = b.ok;
      if (!n.ok) console.error('[onboard] notify email failed:', n.status, await n.text());
      if (!b.ok) console.error('[onboard] broker email failed:', b.status, await b.text());
    } catch (e) {
      console.error('[onboard] resend unreachable:', e);
    }
  }

  return json({ ok: true, emailSent }, 200);
};

// The work-order prompt. Self-contained: a future Claude session gets every
// answer inline plus the workspace files to read, and is told to plan before
// touching anything live.
function buildClaudePrompt(d: Record<string, unknown>): string {
  const v = (k: string) => {
    const x = d[k];
    return x == null || x === '' ? 'not provided' : String(x);
  };
  return [
    `New broker onboarded via the CLP onboarding form. Set them up on the dscrbroker.com lead round-robin.`,
    ``,
    `BROKER`,
    `Name: ${v('fullName')} (NMLS ${v('nmls')})`,
    `Company: ${v('company')} (company NMLS: ${v('companyNmls')})`,
    `Licensed states: ${v('statesLicensed')}`,
    `Wants leads from: ${v('statesWanted')}`,
    `Logo: ${v('logoUrl')}`,
    `Headshot: ${v('headshotUrl')}`,
    `Reviews: ${v('reviewsUrl')}`,
    ``,
    `LEAD DELIVERY`,
    `Cell (text leads here): ${v('leadPhone')}`,
    `Email: ${v('leadEmail')}`,
    `Channels: ${v('deliveryChannels')}`,
    `CRM: ${v('crm')}`,
    `First-contact commitment: ${v('responseSpeed')}`,
    ``,
    `ROUTING RULES`,
    `Monthly lead target: ${v('monthlyLeads')}`,
    `Products: ${v('products')}`,
    `Property types: ${v('propertyTypes')}`,
    `Loan range: ${v('loanRange')}`,
    `Dealbreakers: ${v('dealbreakers')}`,
    `Notes: ${v('notes')}`,
    ``,
    `BILLING (invoice setup, not routing)`,
    `Entity: ${v('billingEntity')} | Email: ${v('billingEmail')} | Method: ${v('paymentMethod')}`,
    ``,
    `TASKS`,
    `1. Read clients/cre-loan-pro/onboarding/CLAUDE.md and clients/dscrbroker/CLAUDE.md first.`,
    `2. Verify the NMLS ID and state licenses on NMLS Consumer Access; flag any mismatch with the states above.`,
    `3. Set up their profile and lead routing on dscrbroker.com for the states they want, using the assets above. If multi-broker round-robin infrastructure does not exist yet for those states, propose the build before touching anything live.`,
    `4. Configure delivery per the channels above and set their rotation weight from the monthly target. Treat loan range, products, and dealbreakers as routing filters.`,
    `5. Show me the plan before anything goes live, then prep their test lead.`,
  ].join('\n');
}

const row = (label: string, value: string) =>
  `<tr>
    <td style="padding:6px 12px 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#71809a;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:14px;color:#0a1a33;font-weight:600;">${escapeHtml(value)}</td>
  </tr>`;

const wrap = (inner: string) =>
  `<div style="background:#f5f7fb;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e9f2;border-radius:12px;padding:32px;">
      ${inner}
    </div>
    <p style="max-width:560px;margin:16px auto 0;font-size:11px;color:#9aa7ba;text-align:center;">CRE Loan Pro</p>
  </div>`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
