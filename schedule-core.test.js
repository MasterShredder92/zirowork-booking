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

test('calendar payload invites the visitor and admin only, locks guest controls, and creates Google Meet', () => {
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
  assert.deepEqual(payload.attendees.map((a) => a.email), ['parent@example.com', 'admin@adkinsenterprisesllc.com']);
  assert.equal(payload.attendees[0].responseStatus, 'needsAction');
  assert.equal(payload.attendees[1].responseStatus, 'accepted');
  assert.doesNotMatch(payload.attendees.map((a) => a.email).join(','), /zach@/i);
  assert.equal(payload.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.ok(payload.conferenceData.createRequest.requestId.startsWith('zirowork-founder-'));
});

test('booking routes request Google invite emails and Meet conference creation without stale Zach attendee logic', () => {
  const waitlistSource = fs.readFileSync(path.join(__dirname, 'api', 'book-waitlist.js'), 'utf8');
  const paidSource = fs.readFileSync(path.join(__dirname, 'api', 'book.js'), 'utf8');

  for (const source of [waitlistSource, paidSource]) {
    assert.match(source, /calendarId:\s*ZACH_CALENDAR_ID/);
    assert.match(source, /conferenceDataVersion:\s*1/);
    assert.match(source, /sendUpdates:\s*['"]all['"]/);
    assert.match(source, /calendar\.events\.insert\s*\(/);
    assert.doesNotMatch(source, /zach@adkinsenterprisesllc\.com/);
  }
});

test('capture route has no hardcoded Kit key and writes waitlist-specific source and stage', () => {
  const source = fs.readFileSync(path.join(__dirname, 'api', 'capture.js'), 'utf8');

  assert.match(source, /const KIT_API_KEY = requireEnv\('KIT_API_KEY'\)/);
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
  assert.doesNotMatch(waitlistSource, /zach@/i);
  assert.match(waitlistSource, /admin@adkinsenterprisesllc\.com/);

  const protectedDiff = require('child_process')
    .execSync('git diff -- package.json vercel.json', { cwd: __dirname, encoding: 'utf8' })
    .trim();

  assert.equal(protectedDiff, '');
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
