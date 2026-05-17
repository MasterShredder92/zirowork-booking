const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ZACH_TIME_ZONE,
  buildCalendarEventPayload,
  buildSlotLabel,
  filterAvailableSlots,
  findSlotOrThrow,
  listCandidateSlots,
  normalizeBusyEvents,
  normalizeTimeZone,
  zonedWallTimeToUTC,
} = require('./api/schedule-core');

test('converts Chicago wall time to UTC with DST instead of browser local timezone', () => {
  const summer = zonedWallTimeToUTC('2026-06-15', '15:00', ZACH_TIME_ZONE);
  const winter = zonedWallTimeToUTC('2026-01-15', '15:00', ZACH_TIME_ZONE);

  assert.equal(summer.toISOString(), '2026-06-15T20:00:00.000Z');
  assert.equal(winter.toISOString(), '2026-01-15T21:00:00.000Z');
});

test('candidate slots carry UTC, Chicago labels, and visitor timezone labels', () => {
  const now = new Date('2026-01-12T00:00:00.000Z');
  const zones = [
    ['America/Chicago', /CST|CDT/],
    ['Europe/London', /GMT|BST/],
    ['Australia/Sydney', /GMT\+11|AEDT|AEST/],
    ['Pacific/Auckland', /GMT\+13|NZDT|NZST/],
  ];

  for (const [visitorTimeZone, localMarker] of zones) {
    const slots = listCandidateSlots({ now, visitorTimeZone });
    assert.ok(slots.length > 0, `${visitorTimeZone} should receive candidate slots`);
    assert.equal(slots[0].visitorTimeZone, visitorTimeZone);
    assert.match(slots[0].startISO, /Z$/);
    assert.match(slots[0].centralLabel, /CST|CDT/);
    assert.match(slots[0].label, visitorTimeZone === ZACH_TIME_ZONE ? /CST|CDT/ : localMarker);
    if (visitorTimeZone !== ZACH_TIME_ZONE) assert.match(slots[0].label, /CST|CDT/);
  }
});

test('every supported IANA timezone can render the same UTC slot without changing Zach calendar time', () => {
  const startUTC = new Date('2026-01-12T16:00:00.000Z'); // 10:00 AM CST in Zach's calendar.
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['America/Chicago', 'Europe/London', 'Australia/Sydney', 'Pacific/Auckland', 'Asia/Tokyo'];

  assert.ok(zones.length > 0, 'runtime should expose timezone coverage');

  for (const visitorTimeZone of zones) {
    const label = buildSlotLabel(startUTC, visitorTimeZone);
    assert.match(label, /10:00 AM CST/);
    assert.doesNotThrow(() => new Date(startUTC).toLocaleString('en-US', { timeZone: visitorTimeZone }));
  }
});

test('invalid visitor timezone safely falls back to Zach calendar timezone', () => {
  assert.equal(normalizeTimeZone('Not/A_Real_Zone'), ZACH_TIME_ZONE);
  const slots = listCandidateSlots({ now: new Date('2026-01-12T00:00:00.000Z'), visitorTimeZone: 'Not/A_Real_Zone' });
  assert.ok(slots.length > 0);
  assert.equal(slots[0].visitorTimeZone, ZACH_TIME_ZONE);
  assert.match(slots[0].label, /CST|CDT/);
});

test('server rejects stale or fake date/time combinations', () => {
  assert.throws(() => {
    findSlotOrThrow({
      selectedDate: '2020-01-01',
      selectedTime: '06:00',
      now: new Date('2026-01-12T00:00:00.000Z'),
      visitorTimeZone: 'Australia/Sydney',
    });
  }, /no longer available/i);
});

test('busy Google events remove matching candidate slot before booking insert', () => {
  const now = new Date('2026-01-12T00:00:00.000Z');
  const slot = listCandidateSlots({ now, visitorTimeZone: 'America/Chicago' })[0];
  const busy = normalizeBusyEvents([
    {
      id: 'existing-event',
      status: 'confirmed',
      summary: 'Existing call',
      start: { dateTime: slot.startISO },
      end: { dateTime: slot.endISO },
    },
  ]);

  assert.equal(filterAvailableSlots([slot], busy).length, 0);
});

test('cancelled Google events do not block slots', () => {
  const now = new Date('2026-01-12T00:00:00.000Z');
  const slot = listCandidateSlots({ now, visitorTimeZone: 'America/Chicago' })[0];
  const busy = normalizeBusyEvents([
    {
      id: 'old-cancelled-event',
      status: 'cancelled',
      start: { dateTime: slot.startISO },
      end: { dateTime: slot.endISO },
    },
  ]);

  assert.equal(filterAvailableSlots([slot], busy).length, 1);
});

test('calendar payload invites the visitor and zach@ organizer, locks guest controls, and creates Google Meet', () => {
  const slot = listCandidateSlots({ now: new Date('2026-01-12T00:00:00.000Z') })[0];
  const payload = buildCalendarEventPayload({
    firstName: 'Test',
    lastName: 'Parent',
    email: 'parent@example.com',
    schoolUrl: 'https://example.com',
    slot,
  });

  assert.equal(payload.start.timeZone, 'America/Chicago');
  assert.equal(payload.end.timeZone, 'America/Chicago');
  assert.equal(payload.guestsCanModify, false);
  assert.equal(payload.guestsCanInviteOthers, false);
  assert.equal(payload.guestsCanSeeOtherGuests, false);
  assert.deepEqual(payload.attendees.map((a) => a.email), ['parent@example.com', 'zach@adkinsenterprisesllc.com']);
  assert.equal(payload.attendees[0].responseStatus, 'needsAction');
  assert.equal(payload.attendees[1].responseStatus, 'accepted');
  assert.match(payload.attendees.map((a) => a.email).join(','), /zach@adkinsenterprisesllc\.com/i);
  assert.equal(payload.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.ok(payload.conferenceData.createRequest.requestId.startsWith('zirowork-founder-'));
});

test('booking routes request Google invite emails and Meet conference creation with zach@ as organizer', () => {
  const waitlistSource = fs.readFileSync(path.join(__dirname, 'api', 'book-waitlist.js'), 'utf8');
  const paidSource = fs.readFileSync(path.join(__dirname, 'api', 'book.js'), 'utf8');

  for (const source of [waitlistSource, paidSource]) {
    assert.match(source, /calendarId:\s*ZACH_CALENDAR_ID/);
    assert.match(source, /conferenceDataVersion:\s*1/);
    assert.match(source, /sendUpdates:\s*['"]all['"]/);
    assert.match(source, /calendar\.events\.insert\s*\(/);
    // zach@ is now the organizer/attendee — it lives in schedule-core.js, not directly in book*.js
  }
});

test('capture route has no hardcoded Kit key and writes waitlist-specific source and stage', () => {
  const source = fs.readFileSync(path.join(__dirname, 'api', 'capture.js'), 'utf8');

  assert.match(source, /requireEnv\('KIT_API_KEY'\)/);
  assert.doesNotMatch(source, /const KIT_API_KEY = requireEnv\('KIT_API_KEY'\)/);
  assert.doesNotMatch(source, /GDLeN7k0im3DEq3y-eydKg/);
  assert.doesNotMatch(source, /@supabase\/supabase-js/);
  assert.match(source, /book\.zirowork\.com\/waitlist/);
  assert.match(source, /waitlist_submitted/);
});

test('live source has no Google delete/update/cancel mutation paths', () => {
  const apiDir = path.join(__dirname, 'api');
  const files = ['book-waitlist.js', 'book.js', 'slots.js', 'schedule-core.js'];
  const source = files.map((file) => fs.readFileSync(path.join(apiDir, file), 'utf8')).join('\n');

  assert.doesNotMatch(source, /events\.delete\s*\(/);
  assert.doesNotMatch(source, /events\.update\s*\(/);
  assert.doesNotMatch(source, /events\.patch\s*\(/);
  assert.doesNotMatch(source, /status\s*:\s*['"]cancelled['"]/);
});

test('slots route validates required Google env vars and keeps protected config untouched', () => {
  const slotsSource = fs.readFileSync(path.join(__dirname, 'api', 'slots.js'), 'utf8');
  const waitlistSource = fs.readFileSync(path.join(__dirname, 'waitlist.html'), 'utf8');

  assert.match(slotsSource, /const GOOGLE_CLIENT_ID = requireEnv\('GOOGLE_CLIENT_ID'\)/);
  assert.match(slotsSource, /const GOOGLE_CLIENT_SECRET = requireEnv\('GOOGLE_CLIENT_SECRET'\)/);
  assert.match(slotsSource, /const GOOGLE_REFRESH_TOKEN = requireEnv\('GOOGLE_REFRESH_TOKEN'\)/);
  assert.match(slotsSource, /calendarId:\s*ZACH_CALENDAR_ID/);
  assert.match(waitlistSource, /zach@adkinsenterprisesllc\.com/);
  assert.match(waitlistSource, /zach@/i);

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
  assert.ok(Array.isArray(vercelConfig.routes), 'Vercel routes should stay explicitly configured');
  assert.ok(Array.isArray(vercelConfig.builds), 'Vercel builds should stay explicitly configured');
});

test('booking routes keep Kit tagging optional so missing Kit env does not block calendar or email flow', () => {
  const waitlistSource = fs.readFileSync(path.join(__dirname, 'api', 'book-waitlist.js'), 'utf8');
  const paidSource = fs.readFileSync(path.join(__dirname, 'api', 'book.js'), 'utf8');

  for (const source of [waitlistSource, paidSource]) {
    assert.doesNotMatch(source, /const KIT_API_KEY = requireEnv\('KIT_API_KEY'\)/);
    assert.match(source, /const KIT_API_KEY = process\.env\.KIT_API_KEY \|\| ''/);
    assert.match(source, /if \(KIT_API_KEY\) \{/);
    assert.match(source, /tag skipped: KIT_API_KEY not configured/);
  }
});

test('waitlist calendar renders only live slots from the slots API', () => {
  const waitlistSource = fs.readFileSync(path.join(__dirname, 'waitlist.html'), 'utf8');
  const bookingSource = fs.readFileSync(path.join(__dirname, 'api', 'book-waitlist.js'), 'utf8');

  assert.doesNotMatch(waitlistSource, /const\s+REAL_SLOTS\s*=/);
  assert.doesNotMatch(waitlistSource, /FAKE_SLOT_INDEX/);
  assert.match(waitlistSource, /fetch\(`\/api\/slots\?/);
  assert.match(waitlistSource, /slotId/);
  assert.match(waitlistSource, /slotStartISO/);
  assert.match(bookingSource, /slot\.id !== slotId/);
  assert.match(bookingSource, /slot\.startISO !== slotStartISO/);
});

test('slot APIs expose calendar auth failures as controlled 503 errors', () => {
  const slotsSource = fs.readFileSync(path.join(__dirname, 'api', 'slots.js'), 'utf8');
  const waitlistBookingSource = fs.readFileSync(path.join(__dirname, 'api', 'book-waitlist.js'), 'utf8');

  for (const source of [slotsSource, waitlistBookingSource]) {
    assert.match(source, /isGoogleAuthError/);
    assert.match(source, /invalid_grant/);
    assert.match(source, /503/);
  }
});


test('paid booking validates live slot identity before Square payment and sends slot identity from the frontend', () => {
  const paidSource = fs.readFileSync(path.join(__dirname, 'api', 'book.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  assert.match(paidSource, /slotId/);
  assert.match(paidSource, /slotStartISO/);
  assert.match(paidSource, /assertSlotIdentity\(\{ selectedDate, selectedTime, visitorTimeZone, slotId, slotStartISO \}\)/);
  assert.ok(paidSource.indexOf('assertSlotIdentity({ selectedDate, selectedTime, visitorTimeZone, slotId, slotStartISO })') < paidSource.indexOf("fetch('https://connect.squareup.com/v2/payments'"));
  assert.match(indexSource, /fetch\(`\/api\/slots\?visitorTimeZone=/);
  assert.match(indexSource, /slotId:liveSlot\.id/);
  assert.match(indexSource, /slotStartISO:liveSlot\.startISO/);
});

test('paid booking post-payment calendar failures tell the customer payment was received', () => {
  const paidSource = fs.readFileSync(path.join(__dirname, 'api', 'book.js'), 'utf8');

  assert.match(paidSource, /let paymentCompleted = false/);
  assert.match(paidSource, /paymentCompleted = true/);
  assert.match(paidSource, /Your payment was received, but the calendar invite could not be created automatically/);
  assert.match(paidSource, /isGoogleAuthError/);
  assert.match(paidSource, /invalid_grant/);
});

test('capture CORS allows production and booking previews but blocks sibling Vercel projects', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'api', 'capture.js'), 'utf8');

  assert.match(source, /book\.zirowork\.com/);
  assert.match(source, /zirowork-booking-\[a-z0-9\]/);
  assert.match(source, /Origin not allowed/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin', '\*'/);

  const envSnapshot = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    KIT_API_KEY: process.env.KIT_API_KEY,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.KIT_API_KEY;
  delete require.cache[require.resolve('./api/capture')];

  try {
    const handler = require('./api/capture');
    const headers = {};
    const res = {
      setHeader(key, value) { headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      end() { this.ended = true; return this; },
      json(payload) { this.payload = payload; return this; },
    };

    await handler({ method: 'OPTIONS', headers: { origin: 'https://book.zirowork.com' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.ended, true);
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://book.zirowork.com');
  } finally {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('./api/capture')];
  }
});

test('security headers allow required payment and tracking vendors without wildcard sources', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
  const headers = config.headers[0].headers;
  const csp = headers.find((header) => header.key === 'Content-Security-Policy').value;

  assert.match(csp, /web\.squarecdn\.com/);
  assert.match(csp, /connect\.squareup\.com/);
  assert.match(csp, /fonts\.googleapis\.com/);
  assert.match(csp, /connect\.facebook\.net/);
  assert.doesNotMatch(csp, /\s\*\s/);
  assert.ok(headers.some((header) => header.key === 'Strict-Transport-Security'));
  assert.ok(headers.some((header) => header.key === 'X-Content-Type-Options'));
});

test('gitignore protects OAuth tokens, env snapshots, and repair scripts', () => {
  const source = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');

  assert.match(source, /\.google_token_response\.json/);
  assert.match(source, /\*token\*\.json/);
  assert.match(source, /vercel-\*\.env/);
  assert.match(source, /exchange_google_code\.py/);
  assert.match(source, /validate_google_calendar_token\.py/);
});
