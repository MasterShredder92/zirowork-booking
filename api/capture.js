// book.zirowork.com — Pre-payment lead capture
// POST /api/capture — fires when user hits "Confirm & Pay" before Square loads
// Saves name + email + selected time to Supabase + Kit so no lead is lost

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gngbyydqjouxkoprzzil.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const KIT_API_KEY = process.env.KIT_API_KEY || 'GDLeN7k0im3DEq3y-eydKg';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
  const sanitizedFirst = (firstName || '').trim();
  const fullName = `${sanitizedFirst} ${(lastName || '').trim()}`.trim();

  // ── SUPABASE INSERT ────────────────────────────────────────────────────────
  if (SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

      const raw_payload = {
        email: sanitizedEmail,
        firstName: sanitizedFirst,
        lastName: (lastName || '').trim(),
        schoolUrl: schoolUrl || null,
        selectedDate: selectedDate || null,
        selectedTime: selectedTime || null,
        selectedDateLabel: selectedDateLabel || null,
        capturedAt: new Date().toISOString(),
        stage: 'pre_payment',
        source: 'book.zirowork.com'
      };

      const metadata = {
        name: fullName || sanitizedEmail,
        email: sanitizedEmail,
        school_url: schoolUrl || null,
        selected_time: selectedDateLabel || null,
        stage: 'pre_payment'
      };

      // Check for existing pre_payment row for this email
      const { data: existing } = await supabase
        .from('intake_submissions')
        .select('id')
        .eq('source', 'book.zirowork.com')
        .eq('tenant_id', TENANT_ID)
        .eq('status', 'pre_payment')
        .filter('raw_payload->>email', 'eq', sanitizedEmail)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase
          .from('intake_submissions')
          .update({ raw_payload, metadata })
          .eq('id', existing[0].id);
        console.log('[capture] Updated pre_payment row:', existing[0].id);
      } else {
        const { error: insertErr } = await supabase
          .from('intake_submissions')
          .insert([{
            tenant_id: TENANT_ID,
            source: 'book.zirowork.com',
            form_version: 'v1',
            status: 'pre_payment',
            raw_payload,
            metadata
          }]);

        if (insertErr) {
          console.error('[capture] Supabase insert error:', JSON.stringify(insertErr));
        } else {
          console.log('[capture] Pre-payment lead saved:', sanitizedEmail);
        }
      }
    } catch (err) {
      console.error('[capture] Supabase exception:', err.message);
    }
  } else {
    console.error('[capture] SUPABASE_SERVICE_KEY not set');
  }

  // ── KIT UPSERT ─────────────────────────────────────────────────────────────
  try {
    const kitPayload = {
      api_key: KIT_API_KEY,
      email: sanitizedEmail,
      first_name: sanitizedFirst || sanitizedEmail.split('@')[0],
      fields: {
        booking_intent: 'true',
        booking_intent_at: new Date().toISOString(),
        booking_selected_time: selectedDateLabel || selectedTime || null,
        school_url: schoolUrl || null,
        last_name: (lastName || '').trim() || undefined
      }
    };

    const subRes = await fetch('https://api.convertkit.com/v3/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kitPayload)
    });

    if (!subRes.ok) {
      const errText = await subRes.text();
      console.error('[capture] Kit error', subRes.status, errText);
    } else {
      console.log('[capture] Kit subscriber upserted:', sanitizedEmail);
    }
  } catch (err) {
    console.error('[capture] Kit exception:', err.message);
  }

  return res.status(200).json({ ok: true });
};
