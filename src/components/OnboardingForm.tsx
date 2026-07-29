import { useEffect, useMemo, useRef, useState } from 'react';

// CLP broker onboarding survey. One question per screen, five sections.
// Fires ONE webhook on submit via /api/onboard (standing rule: no partials).
// Logo/headshot upload as multipart; the API stores them in Vercel Blob and
// forwards URLs, so the Zap and the emails only ever see JSON + links.

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
];

type StepId =
  | 'name' | 'company' | 'nmls' | 'companyNmls' | 'statesLicensed' | 'statesWanted'
  | 'logo' | 'headshot' | 'reviewsUrl'
  | 'leadPhone' | 'leadEmail' | 'deliveryChannels' | 'crm' | 'responseSpeed'
  | 'monthlyLeads' | 'products' | 'propertyTypes' | 'loanRange' | 'dealbreakers'
  | 'billingEntity' | 'billingEmail' | 'paymentMethod' | 'notes';

interface StepDef {
  id: StepId;
  section: number; // 0..4
  title: string;
  helper?: string;
  optional?: boolean;
}

const SECTIONS = ['You + your license', 'Your profile', 'Lead delivery', 'Capacity + products', 'Billing'];

const STEPS: StepDef[] = [
  { id: 'name', section: 0, title: 'Your name' },
  { id: 'company', section: 0, title: 'Company or brokerage name', helper: 'Exactly as it should appear on your broker profile.' },
  { id: 'nmls', section: 0, title: 'Your personal NMLS ID', helper: 'We verify it before your profile goes live.' },
  { id: 'companyNmls', section: 0, title: 'Company NMLS ID', helper: 'Skip this if you originate under your personal license only.', optional: true },
  { id: 'statesLicensed', section: 0, title: 'Which states are you licensed in?', helper: 'Select every state where you hold an active license. Leads can only be routed to you in these states.' },
  { id: 'statesWanted', section: 0, title: 'Which of those states do you want leads from?', helper: 'Most brokers take all of them. You can narrow this later.' },
  { id: 'logo', section: 1, title: 'Upload your company logo', helper: 'PNG or SVG with a transparent background works best. Not on this device? Skip it and text it to me after.', optional: true },
  { id: 'headshot', section: 1, title: 'Upload a headshot', helper: 'Optional but worth it. Borrowers respond better when they can see who they are calling.', optional: true },
  { id: 'reviewsUrl', section: 1, title: 'Link to your reviews', helper: 'Google Business Profile, Zillow, Experience.com, wherever they live. Strong reviews make your profile work harder.', optional: true },
  { id: 'leadPhone', section: 2, title: 'Best cell number for lead delivery', helper: 'New leads are texted to this number the moment they come in.' },
  { id: 'leadEmail', section: 2, title: 'Best email for lead delivery', helper: 'Every lead also lands here with full details.' },
  { id: 'deliveryChannels', section: 2, title: 'How should we deliver your leads?', helper: 'Select every channel you want. Most brokers run text plus CRM.' },
  { id: 'crm', section: 2, title: 'Which CRM do you use?', helper: 'If yours is not listed, pick Other and type it in.' },
  { id: 'responseSpeed', section: 2, title: 'How quickly will you contact a new lead?', helper: 'Be honest. Speed to lead drives close rate, and this tells us how to set borrower expectations.' },
  { id: 'monthlyLeads', section: 3, title: 'How many leads per month do you want?', helper: 'This sets your share of the rotation. You can adjust it any time.' },
  { id: 'products', section: 3, title: 'Which DSCR products do you offer?' },
  { id: 'propertyTypes', section: 3, title: 'Which property types do you lend on?' },
  { id: 'loanRange', section: 3, title: 'What loan sizes will you take?', helper: 'Leads outside this range will not be routed to you.' },
  { id: 'dealbreakers', section: 3, title: 'Anything you will not lend on?', helper: 'Rural properties, credit below 620, land, specific scenarios. Tell us now and you will never see one.', optional: true },
  { id: 'billingEntity', section: 4, title: 'Legal entity name for invoicing', helper: 'Exactly as it should appear on your invoices.' },
  { id: 'billingEmail', section: 4, title: 'Billing email', helper: 'Where invoices and receipts go.' },
  { id: 'paymentMethod', section: 4, title: 'Preferred payment method' },
  { id: 'notes', section: 4, title: 'Anything else we should know?', helper: 'Last one. Volume goals, lender relationships, anything that helps us route you better.', optional: true },
];

const CHIP_OPTIONS: Partial<Record<StepId, string[]>> = {
  deliveryChannels: ['Text me', 'Email me', 'Straight into my CRM'],
  crm: ['GoHighLevel', 'Salesforce', 'HubSpot', 'Follow Up Boss', 'Jungo', 'Zoho', 'Other', 'No CRM yet'],
  responseSpeed: ['Under 5 minutes', 'Under 30 minutes', 'Within the hour', 'Same day'],
  monthlyLeads: ['5 to 10', '10 to 20', '20 to 40', 'Open the firehose'],
  products: ['Purchase', 'Cash-out refi', 'Rate/term refi', 'No-ratio', 'Short-term rental', 'Portfolio / blanket', 'Fix-and-flip bridge', 'New construction'],
  propertyTypes: ['Single family', '2-4 unit', 'Condo / townhome', '5+ units', 'Mixed-use'],
  paymentMethod: ['Card on file', 'ACH / bank transfer', 'Invoice me'],
};

const LOAN_MIN = ['No minimum', '$75K', '$100K', '$150K', '$250K'];
const LOAN_MAX = ['$1M', '$2M', '$3M', '$5M', 'No max'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^\S+\.\S+$/;

function formatPhone(raw: string): string {
  // strip +1 country code that mobile autofill loves to prepend
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Downscale big raster images client-side so the serverless body stays small.
// SVGs and small files pass through untouched. Falls back to the original on
// any decode failure (e.g. odd formats headless canvas cannot read).
async function shrinkImage(file: File): Promise<File> {
  if (file.type === 'image/svg+xml' || file.size < 2_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

type Answers = {
  firstName: string; lastName: string; company: string; nmls: string; companyNmls: string;
  statesLicensed: string[]; statesWantedMode: 'all' | 'pick' | ''; statesWanted: string[];
  logoFile: File | null; headshotFile: File | null; reviewsUrl: string;
  leadPhone: string; leadEmail: string; deliveryChannels: string[]; crm: string; crmOther: string;
  responseSpeed: string; monthlyLeads: string; products: string[]; propertyTypes: string[];
  loanMin: string; loanMax: string; dealbreakers: string;
  billingEntity: string; billingEmail: string; paymentMethod: string; notes: string;
};

const EMPTY: Answers = {
  firstName: '', lastName: '', company: '', nmls: '', companyNmls: '',
  statesLicensed: [], statesWantedMode: '', statesWanted: [],
  logoFile: null, headshotFile: null, reviewsUrl: '',
  leadPhone: '', leadEmail: '', deliveryChannels: [], crm: '', crmOther: '',
  responseSpeed: '', monthlyLeads: '', products: [], propertyTypes: [],
  loanMin: '', loanMax: '', dealbreakers: '',
  billingEntity: '', billingEmail: '', paymentMethod: '', notes: '',
};

type Phase = 'welcome' | 'form' | 'sending' | 'done' | 'error';

export default function OnboardingForm() {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const startedAt = useRef<number>(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const def = STEPS[step];
  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (phase !== 'form') return;
    setTouched(false);
    // focus the first text input of the new step (not file pickers)
    const t = setTimeout(() => {
      cardRef.current?.querySelector<HTMLElement>('input:not([type=file]), textarea, select')?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [step, phase]);

  const valid = useMemo(() => {
    switch (def?.id) {
      case 'name': return a.firstName.trim().length > 1 && a.lastName.trim().length > 1;
      case 'company': return a.company.trim().length > 1;
      case 'nmls': return /^\d{4,10}$/.test(a.nmls.trim());
      case 'companyNmls': return a.companyNmls.trim() === '' || /^\d{4,10}$/.test(a.companyNmls.trim());
      case 'statesLicensed': return a.statesLicensed.length > 0;
      case 'statesWanted': return a.statesWantedMode === 'all' || (a.statesWantedMode === 'pick' && a.statesWanted.length > 0);
      case 'logo': return true;
      case 'headshot': return true;
      case 'reviewsUrl': return a.reviewsUrl.trim() === '' || URL_RE.test(a.reviewsUrl.trim());
      case 'leadPhone': return a.leadPhone.replace(/\D/g, '').length === 10;
      case 'leadEmail': return EMAIL_RE.test(a.leadEmail.trim());
      case 'deliveryChannels': return a.deliveryChannels.length > 0;
      case 'crm': return a.crm !== '' && (a.crm !== 'Other' || a.crmOther.trim().length > 1);
      case 'responseSpeed': return a.responseSpeed !== '';
      case 'monthlyLeads': return a.monthlyLeads !== '';
      case 'products': return a.products.length > 0;
      case 'propertyTypes': return a.propertyTypes.length > 0;
      case 'loanRange': return a.loanMin !== '' && a.loanMax !== '';
      case 'dealbreakers': return true;
      case 'billingEntity': return a.billingEntity.trim().length > 1;
      case 'billingEmail': return EMAIL_RE.test(a.billingEmail.trim());
      case 'paymentMethod': return a.paymentMethod !== '';
      case 'notes': return true;
      default: return false;
    }
  }, [a, def]);

  const next = () => {
    if (!valid) { setTouched(true); return; }
    if (step === STEPS.length - 1) { submit(); return; }
    setStep(step + 1);
  };
  const back = () => { if (step > 0) setStep(step - 1); };

  const pickOne = (id: StepId, value: string) => {
    if (id === 'crm') {
      set({ crm: value });
      if (value !== 'Other') setTimeout(() => setStep((s) => s + 1), 240);
      return;
    }
    set({ [id]: value } as Partial<Answers>);
    if (step < STEPS.length - 1) setTimeout(() => setStep((s) => s + 1), 240);
  };

  const toggleMulti = (id: 'deliveryChannels' | 'products' | 'propertyTypes' | 'statesLicensed' | 'statesWanted', value: string) => {
    const cur = a[id];
    set({ [id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Partial<Answers>);
  };

  async function submit() {
    setPhase('sending');
    const statesWanted = a.statesWantedMode === 'all'
      ? a.statesLicensed
      : a.statesWanted.filter((s) => a.statesLicensed.includes(s));
    const reviews = a.reviewsUrl.trim();
    const payload = {
      source: 'clp-broker-onboarding',
      partial: false,
      firstName: a.firstName.trim(),
      lastName: a.lastName.trim(),
      fullName: `${a.firstName.trim()} ${a.lastName.trim()}`,
      company: a.company.trim(),
      nmls: a.nmls.trim(),
      companyNmls: a.companyNmls.trim() || null,
      statesLicensed: a.statesLicensed.join(', '),
      statesWanted: statesWanted.join(', '),
      reviewsUrl: reviews === '' ? null : /^https?:\/\//i.test(reviews) ? reviews : `https://${reviews}`,
      leadPhone: a.leadPhone,
      leadEmail: a.leadEmail.trim(),
      deliveryChannels: a.deliveryChannels.join(', '),
      crm: a.crm === 'Other' ? a.crmOther.trim() : a.crm,
      responseSpeed: a.responseSpeed,
      monthlyLeads: a.monthlyLeads,
      products: a.products.join(', '),
      propertyTypes: a.propertyTypes.join(', '),
      loanRange: `${a.loanMin} to ${a.loanMax}`,
      loanMin: a.loanMin,
      loanMax: a.loanMax,
      dealbreakers: a.dealbreakers.trim() || null,
      billingEntity: a.billingEntity.trim(),
      billingEmail: a.billingEmail.trim(),
      paymentMethod: a.paymentMethod,
      notes: a.notes.trim() || null,
      secondsToComplete: Math.round((Date.now() - startedAt.current) / 1000),
      website: (document.getElementById('ob-website') as HTMLInputElement | null)?.value ?? '',
    };
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      if (a.logoFile) fd.append('logo', await shrinkImage(a.logoFile));
      if (a.headshotFile) fd.append('headshot', await shrinkImage(a.headshotFile));
      const res = await fetch('/api/onboard', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error('submit failed');
      setEmailSent(body.emailSent === true);
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }

  /* ---------- screens ---------- */

  if (phase === 'welcome') {
    return (
      <Card>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue">Lead network onboarding</p>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">You're in. Let's get you set up.</h1>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-soft">
          This form collects everything we need to build your broker profile, wire up your
          lead delivery, and add you to the rotation. About 5 minutes, one time, five sections:
        </p>
        <ol className="mt-5 space-y-2.5">
          {SECTIONS.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-[15px] font-medium">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-tint text-[12px] font-bold text-blue-deep">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-ink-soft">
          Once it's in, give us 3 to 5 days to verify licensing and build your routing.
          Then leads start hitting your phone.
        </p>
        <button
          onClick={() => { startedAt.current = Date.now(); setPhase('form'); }}
          className="mt-7 rounded-xl bg-blue px-8 py-3.5 text-[15px] font-bold text-white shadow-btn transition-transform hover:-translate-y-0.5 hover:bg-blue-deep"
        >
          Start
        </button>
        <p className="mt-4 text-[13px] text-ink-faint">Questions mid-form? Text me. You have my number.</p>
      </Card>
    );
  }

  if (phase === 'sending') {
    return (
      <Card center>
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-line border-t-blue" />
        <p className="mt-4 text-[15px] font-semibold text-ink-soft">Locking it in...</p>
      </Card>
    );
  }

  if (phase === 'done') {
    const timeline: Array<[string, string]> = [
      ['Day 1', 'We verify your NMLS and state licensing.'],
      ['Days 2-3', 'We build your profile and wire your delivery channels.'],
      ['Days 4-5', 'You get a test lead to confirm everything fires.'],
      ['Then', "You're live in the rotation. Real leads, real time."],
    ];
    return (
      <Card>
        <div className="ring-pop flex h-14 w-14 items-center justify-center rounded-full bg-good-tint">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path className="check-draw" d="M6 14.5 L11.5 20 L22 8.5" stroke="#0e9f6e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-5 text-3xl font-extrabold sm:text-4xl">That's everything we need.</h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
          Your setup starts now, {a.firstName.trim()}. Here's what the next 3 to 5 days look like:
        </p>
        <ul className="mt-6 space-y-4">
          {timeline.map(([when, what]) => (
            <li key={when} className="flex gap-4">
              <span className="w-16 shrink-0 pt-0.5 text-[12px] font-bold uppercase tracking-wide text-blue-deep">{when}</span>
              <span className="text-[15px] leading-relaxed text-ink-soft">{what}</span>
            </li>
          ))}
        </ul>
        {emailSent && (
          <p className="mt-6 rounded-xl bg-blue-tint px-4 py-3 text-sm leading-relaxed text-blue-deep">
            A confirmation just went to {a.leadEmail.trim()}. If it's not there in a couple minutes, check spam once, then text me.
          </p>
        )}
        <p className="mt-5 text-[13px] text-ink-faint">I'll text you when your test lead is on the way.</p>
      </Card>
    );
  }

  if (phase === 'error') {
    return (
      <Card>
        <h1 className="text-2xl font-extrabold">That didn't go through.</h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
          Your answers are still here. Give it another shot, and if it fails twice, text me
          and I'll take it over the phone.
        </p>
        <button
          onClick={() => submit()}
          className="mt-6 rounded-xl bg-blue px-8 py-3.5 text-[15px] font-bold text-white shadow-btn transition-transform hover:-translate-y-0.5 hover:bg-blue-deep"
        >
          Try again
        </button>
      </Card>
    );
  }

  /* ---------- the form ---------- */

  const pct = Math.round((step / STEPS.length) * 100);
  const autoAdvance = (['responseSpeed', 'monthlyLeads', 'paymentMethod'] as StepId[]).includes(def.id);
  const isLast = step === STEPS.length - 1;

  return (
    <Card>
      {/* progress */}
      <div className="mb-7">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-deep">
            {String(def.section + 1).padStart(2, '0')} / {SECTIONS[def.section]}
          </p>
          <p className="text-[11px] font-semibold text-ink-faint">{pct}%</p>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-blue transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
      </div>

      <div key={step} ref={cardRef} className="step-enter">
        <h2 className="text-2xl font-extrabold sm:text-[27px]">{def.title}</h2>
        {def.helper && <p className="mt-2 text-[14px] leading-relaxed text-ink-faint">{def.helper}</p>}

        <div className="mt-6">
          <StepBody def={def} a={a} set={set} pickOne={pickOne} toggleMulti={toggleMulti} next={next} />
        </div>

        {touched && !valid && (
          <p className="mt-3 text-sm font-semibold text-red-600">We need this one before we keep moving.</p>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button onClick={back} disabled={step === 0} className="text-sm font-semibold text-ink-faint transition-colors hover:text-ink disabled:invisible">
            &larr; Back
          </button>
          {!autoAdvance && (
            <button
              onClick={next}
              className="rounded-xl bg-blue px-7 py-3 text-[15px] font-bold text-white shadow-btn transition-transform hover:-translate-y-0.5 hover:bg-blue-deep"
            >
              {isLast ? 'Lock it in' : def.optional && isEmptyOptional(def.id, a) ? 'Skip' : 'Continue'}
            </button>
          )}
        </div>
      </div>

      {/* honeypot */}
      <input id="ob-website" name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
    </Card>
  );
}

function isEmptyOptional(id: StepId, a: Answers): boolean {
  if (id === 'companyNmls') return a.companyNmls.trim() === '';
  if (id === 'logo') return a.logoFile === null;
  if (id === 'headshot') return a.headshotFile === null;
  if (id === 'reviewsUrl') return a.reviewsUrl.trim() === '';
  if (id === 'dealbreakers') return a.dealbreakers.trim() === '';
  if (id === 'notes') return a.notes.trim() === '';
  return false;
}

function Card({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className={`relative rounded-2xl border border-line bg-card p-7 shadow-card sm:p-10 ${center ? 'text-center' : ''}`}>
      {children}
    </div>
  );
}

/* ---------- per-step bodies ---------- */

function StepBody({ def, a, set, pickOne, toggleMulti, next }: {
  def: StepDef; a: Answers; set: (p: Partial<Answers>) => void;
  pickOne: (id: StepId, v: string) => void;
  toggleMulti: (id: 'deliveryChannels' | 'products' | 'propertyTypes' | 'statesLicensed' | 'statesWanted', v: string) => void;
  next: () => void;
}) {
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); next(); } };

  switch (def.id) {
    case 'name':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="First name" autoComplete="given-name" value={a.firstName} onChange={(v) => set({ firstName: v })} onKeyDown={onEnter} />
          <Input placeholder="Last name" autoComplete="family-name" value={a.lastName} onChange={(v) => set({ lastName: v })} onKeyDown={onEnter} />
        </div>
      );
    case 'company':
      return <Input placeholder="e.g. Barrett Financial Group" autoComplete="organization" value={a.company} onChange={(v) => set({ company: v })} onKeyDown={onEnter} />;
    case 'nmls':
      return <Input placeholder="e.g. 239185" inputMode="numeric" value={a.nmls} onChange={(v) => set({ nmls: v.replace(/\D/g, '') })} onKeyDown={onEnter} />;
    case 'companyNmls':
      return <Input placeholder="Optional" inputMode="numeric" value={a.companyNmls} onChange={(v) => set({ companyNmls: v.replace(/\D/g, '') })} onKeyDown={onEnter} />;
    case 'statesLicensed':
      return <StateGrid selected={a.statesLicensed} onToggle={(s) => toggleMulti('statesLicensed', s)} />;
    case 'statesWanted':
      return (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <BigChip
              label="All of them"
              sub={`Every state I'm licensed in (${a.statesLicensed.length})`}
              selected={a.statesWantedMode === 'all'}
              onClick={() => set({ statesWantedMode: 'all', statesWanted: [] })}
            />
            <BigChip
              label="Let me pick"
              sub="Only certain states"
              selected={a.statesWantedMode === 'pick'}
              onClick={() => set({ statesWantedMode: 'pick' })}
            />
          </div>
          {a.statesWantedMode === 'pick' && (
            <div className="mt-4">
              <StateGrid states={a.statesLicensed} selected={a.statesWanted} onToggle={(s) => toggleMulti('statesWanted', s)} />
            </div>
          )}
        </div>
      );
    case 'logo':
      return <FilePick id="logo" label="Choose logo file" file={a.logoFile} onPick={(f) => set({ logoFile: f })} />;
    case 'headshot':
      return <FilePick id="headshot" label="Choose photo" file={a.headshotFile} onPick={(f) => set({ headshotFile: f })} />;
    case 'reviewsUrl':
      return <Input placeholder="Paste the link" inputMode="url" value={a.reviewsUrl} onChange={(v) => set({ reviewsUrl: v })} onKeyDown={onEnter} />;
    case 'leadPhone':
      return <Input placeholder="(555) 123-4567" type="tel" inputMode="tel" autoComplete="tel-national" value={a.leadPhone} onChange={(v) => set({ leadPhone: formatPhone(v) })} onKeyDown={onEnter} />;
    case 'leadEmail':
      return <Input placeholder="you@yourshop.com" type="email" autoComplete="email" value={a.leadEmail} onChange={(v) => set({ leadEmail: v })} onKeyDown={onEnter} />;
    case 'deliveryChannels':
      return <ChipGrid options={CHIP_OPTIONS.deliveryChannels!} selected={a.deliveryChannels} onToggle={(v) => toggleMulti('deliveryChannels', v)} />;
    case 'crm':
      return (
        <div>
          <ChipGrid options={CHIP_OPTIONS.crm!} selected={a.crm ? [a.crm] : []} onToggle={(v) => pickOne('crm', v)} single />
          {a.crm === 'Other' && (
            <div className="mt-4">
              <Input placeholder="Which one?" value={a.crmOther} onChange={(v) => set({ crmOther: v })} onKeyDown={onEnter} />
            </div>
          )}
        </div>
      );
    case 'responseSpeed':
      return <ChipGrid options={CHIP_OPTIONS.responseSpeed!} selected={a.responseSpeed ? [a.responseSpeed] : []} onToggle={(v) => pickOne('responseSpeed', v)} single />;
    case 'monthlyLeads':
      return <ChipGrid options={CHIP_OPTIONS.monthlyLeads!} selected={a.monthlyLeads ? [a.monthlyLeads] : []} onToggle={(v) => pickOne('monthlyLeads', v)} single />;
    case 'products':
      return <ChipGrid options={CHIP_OPTIONS.products!} selected={a.products} onToggle={(v) => toggleMulti('products', v)} />;
    case 'propertyTypes':
      return <ChipGrid options={CHIP_OPTIONS.propertyTypes!} selected={a.propertyTypes} onToggle={(v) => toggleMulti('propertyTypes', v)} />;
    case 'loanRange':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Minimum" options={LOAN_MIN} value={a.loanMin} onChange={(v) => set({ loanMin: v })} />
          <Select label="Maximum" options={LOAN_MAX} value={a.loanMax} onChange={(v) => set({ loanMax: v })} />
        </div>
      );
    case 'dealbreakers':
      return <TextArea placeholder="Optional, but this is the one that saves us both headaches." value={a.dealbreakers} onChange={(v) => set({ dealbreakers: v })} />;
    case 'billingEntity':
      return <Input placeholder="e.g. Peisner Lending LLC" autoComplete="organization" value={a.billingEntity} onChange={(v) => set({ billingEntity: v })} onKeyDown={onEnter} />;
    case 'billingEmail':
      return (
        <div>
          <Input placeholder="billing@yourshop.com" type="email" value={a.billingEmail} onChange={(v) => set({ billingEmail: v })} onKeyDown={onEnter} />
          {a.leadEmail && a.billingEmail !== a.leadEmail && (
            <button onClick={() => set({ billingEmail: a.leadEmail })} className="mt-2.5 text-[13px] font-semibold text-blue-deep underline underline-offset-2 hover:text-blue">
              Same as lead email ({a.leadEmail})
            </button>
          )}
        </div>
      );
    case 'paymentMethod':
      return <ChipGrid options={CHIP_OPTIONS.paymentMethod!} selected={a.paymentMethod ? [a.paymentMethod] : []} onToggle={(v) => pickOne('paymentMethod', v)} single />;
    case 'notes':
      return <TextArea placeholder="Optional. Volume goals, lender relationships, the works." value={a.notes} onChange={(v) => set({ notes: v })} />;
    default:
      return null;
  }
}

/* ---------- primitives ---------- */

function Input(props: {
  placeholder: string; value: string; onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void; type?: string; inputMode?: 'numeric' | 'tel' | 'url';
  autoComplete?: string;
}) {
  return (
    <input
      type={props.type ?? 'text'}
      inputMode={props.inputMode}
      autoComplete={props.autoComplete}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={props.onKeyDown}
      className="w-full rounded-xl border border-line bg-card px-4 py-3.5 text-[16px] font-medium shadow-chip transition-colors placeholder:font-normal placeholder:text-ink-faint focus:border-blue"
    />
  );
}

function TextArea(props: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      rows={4}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full resize-none rounded-xl border border-line bg-card px-4 py-3.5 text-[16px] font-medium shadow-chip transition-colors placeholder:font-normal placeholder:text-ink-faint focus:border-blue"
    />
  );
}

function Select(props: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-ink-faint">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-xl border border-line bg-card px-4 py-3.5 text-[16px] font-medium shadow-chip focus:border-blue"
      >
        <option value="" disabled>Select</option>
        {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function FilePick({ id, label, file, onPick }: {
  id: string; label: string; file: File | null; onPick: (f: File | null) => void;
}) {
  const preview = useMemo(
    () => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null),
    [file]
  );
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (file) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-blue bg-blue-tint p-4">
        {preview ? (
          <img src={preview} alt="" className="h-16 w-16 rounded-lg border border-line bg-card object-contain" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-line bg-card text-xs font-bold text-ink-faint">FILE</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-blue-deep">{file.name}</p>
          <p className="text-[13px] text-ink-faint">{Math.max(1, Math.round(file.size / 1024))} KB</p>
        </div>
        <button
          type="button"
          onClick={() => onPick(null)}
          className="shrink-0 text-[13px] font-semibold text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={`file-${id}`}
      className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-paper px-6 py-10 text-center transition-colors hover:border-blue/60"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 16V4m0 0 4 4m-4-4L8 8" stroke="#1e5eff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="#71809a" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-bold text-ink">{label}</span>
      <span className="text-[13px] text-ink-faint">PNG, JPG, or SVG. Tap to browse.</span>
      <input
        id={`file-${id}`}
        type="file"
        accept="image/*,.svg"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function ChipGrid({ options, selected, onToggle, single = false }: {
  options: string[]; selected: string[]; onToggle: (v: string) => void; single?: boolean;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" role={single ? 'radiogroup' : 'group'}>
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            role={single ? 'radio' : 'checkbox'}
            aria-checked={on}
            onClick={() => onToggle(o)}
            className={`flex items-center justify-between rounded-xl border px-4 py-3.5 text-left text-[15px] font-semibold shadow-chip transition-all hover:-translate-y-px ${
              on ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-card text-ink hover:border-blue/50'
            }`}
          >
            {o}
            <span
              className={`ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-all ${
                on ? 'border-blue bg-blue text-white' : 'border-line bg-card text-transparent'
              }`}
            >
              &#10003;
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BigChip({ label, sub, selected, onClick }: { label: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-4 text-left shadow-chip transition-all hover:-translate-y-px ${
        selected ? 'border-blue bg-blue-tint' : 'border-line bg-card hover:border-blue/50'
      }`}
    >
      <span className={`block text-[15px] font-bold ${selected ? 'text-blue-deep' : 'text-ink'}`}>{label}</span>
      <span className="mt-0.5 block text-[13px] text-ink-faint">{sub}</span>
    </button>
  );
}

function StateGrid({ states = STATES, selected, onToggle }: { states?: string[]; selected: string[]; onToggle: (s: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
      {states.map((s) => {
        const on = selected.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s)}
            className={`rounded-lg border py-2 text-[12px] font-bold transition-all ${
              on ? 'border-blue bg-blue text-white shadow-btn' : 'border-line bg-card text-ink-soft hover:border-blue/60 hover:text-ink'
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
