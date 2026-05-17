// api/capture.js — non-blocking pre-payment lead capture
// Saves name, email, school URL, and selected time to Supabase + Kit.

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CAPTURE_SOURCE = 'book.zirowork.com/waitlist';
const CAPTURE_STAGE = 'waitlist_submitted';
const ALLOWED_ORIGINS = new Set([
  'https://book.zirowork.com',
  'https://www.book.zirowork.com',
  'http://localhost:3000',
  'http://localhost:5173',
]);
const BOOKING_PREVIEW_ORIGIN = /^https:\/\/zirowork-booking-[a-z0-9][a-z0-9-]*\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin) || BOOKING_PREVIEW_ORIGIN.test(origin);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'https://book.zirowork.com');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function supabaseHeaders(prefer) {
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function findExistingLead(email) {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const params = new URLSearchParams({
    source: `eq.${CAPTURE_SOURCE}`,
    tenant_id: `eq.${TENANT_ID}`,
    status: `eq.${CAPTURE_STAGE}`,
    select: 'id',
    limit: '1',
  });
  params.append('raw_payload->>email', `eq.${email}`);

  const response = await fetch(`${supabaseUrl}/rest/v1/intake_submissions?${params.toString()}`, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase lookup failed ${response.status}: ${body}`);
  }

  return response.json();
}

async function upsertLead({ email, firstName, lastName, schoolUrl, selectedDate, selectedTime, selectedDateLabel }) {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const sanitizedFirst = (firstName || '').trim();
  const sanitizedLast = (lastName || '').trim();
  const fullName = `${sanitizedFirst} ${sanitizedLast}`.trim();

  const raw_payload = {
    email,
    firstName: sanitizedFirst,
    lastName: sanitizedLast,
    schoolUrl: schoolUrl || null,
    selectedDate: selectedDate || null,
    selectedTime: selectedTime || null,
    selectedDateLabel: selectedDateLabel || null,
    capturedAt: new Date().toISOString(),
    stage: CAPTURE_STAGE,
    source: CAPTURE_SOURCE,
  };

  const metadata = {
    name: fullName || email,
    email,
    school_url: schoolUrl || null,
    selected_time: selectedDateLabel || selectedTime || null,
    stage: CAPTURE_STAGE,
  };

  const existing = await findExistingLead(email);

  if (existing && existing.length > 0) {
    const response = await fetch(`${supabaseUrl}/rest/v1/intake_submissions?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({ raw_payload, metadata }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase update failed ${response.status}: ${body}`);
    }

    console.log('[capture] Updated waitlist lead:', existing[0].id, email);
    return;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/intake_submissions`, {
    method: 'POST',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify([{
      tenant_id: TENANT_ID,
      source: CAPTURE_SOURCE,
      form_version: 'v1',
      status: CAPTURE_STAGE,
      raw_payload,
      metadata,
    }]),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase insert failed ${response.status}: ${body}`);
  }

  console.log('[capture] Saved waitlist lead:', email);
}

async function upsertKitSubscriber({ email, firstName, lastName, schoolUrl, selectedTime, selectedDateLabel }) {
  const kitApiKey = requireEnv('KIT_API_KEY');
  const response = await fetch('https://api.convertkit.com/v3/subscribers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: kitApiKey,
      email,
      first_name: (firstName || '').trim() || email.split('@')[0],
      fields: {
        booking_intent: 'true',
        booking_intent_at: new Date().toISOString(),
        booking_selected_time: selectedDateLabel || selectedTime || null,
        school_url: schoolUrl || null,
        last_name: (lastName || '').trim() || undefined,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kit upsert failed ${response.status}: ${body}`);
  }

  console.log('[capture] Kit subscriber upserted:', email);
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);

  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const { firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel } = body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Email required' });
  }

  const sanitizedEmail = email.trim().toLowerCase();
  const payload = {
    email: sanitizedEmail,
    firstName,
    lastName,
    schoolUrl,
    selectedDate,
    selectedTime,
    selectedDateLabel,
  };

  try {
    await upsertLead(payload);
  } catch (err) {
    console.error('[capture] Supabase failed:', err.message, { email: sanitizedEmail });
  }

  try {
    await upsertKitSubscriber(payload);
  } catch (err) {
    console.error('[capture] Kit failed:', err.message, { email: sanitizedEmail });
  }

  return res.status(200).json({ ok: true });
};
