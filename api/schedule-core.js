// api/schedule-core.js
// Shared booking rules for book.zirowork.com.
// The backend is the source of truth. All slots are defined in America/Chicago.

const ZACH_TIME_ZONE = 'America/Chicago';
const ADMIN_EMAIL = 'admin@adkinsenterprisesllc.com';
const SLOT_MINUTES = 30;
const BOOKING_WINDOW_DAYS = 7;

// Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// This matches the public waitlist page's current published availability.
const AVAILABILITY = Object.freeze({
  1: ['06:00', '07:00', '10:00', '15:00', '20:00', '21:00'],
  2: ['06:00', '07:00', '10:00', '15:00', '20:00', '21:00'],
  3: ['06:00', '07:00', '10:00', '15:00', '20:00', '21:00'],
  4: ['06:00', '07:00', '10:00', '15:00', '20:00', '21:00'],
  5: ['06:00', '07:00', '10:00', '15:00'],
});

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!match) throw new Error('Invalid selectedDate. Expected YYYY-MM-DD.');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseTimeKey(timeKey) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeKey || '');
  if (!match) throw new Error('Invalid selectedTime. Expected HH:MM.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Invalid selectedTime. Expected HH:MM.');
  return { hour, minute };
}

function normalizeTimeZone(timeZone = ZACH_TIME_ZONE) {
  if (!timeZone || typeof timeZone !== 'string') return ZACH_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return timeZone;
  } catch (_err) {
    return ZACH_TIME_ZONE;
  }
}

function getTimeZoneParts(date, timeZone = ZACH_TIME_ZONE) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

function getDateKeyInZone(date = new Date(), timeZone = ZACH_TIME_ZONE) {
  const p = getTimeZoneParts(date, normalizeTimeZone(timeZone));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function getWeekdayInZone(date = new Date(), timeZone = ZACH_TIME_ZONE) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone, weekday: 'long' }).format(date);
  return { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }[weekday];
}

function getOffsetMinutesForZone(date, timeZone = ZACH_TIME_ZONE) {
  const p = getTimeZoneParts(date, normalizeTimeZone(timeZone));
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function zonedWallTimeToUTC(dateKey, timeKey, timeZone = ZACH_TIME_ZONE) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const { year, month, day } = parseDateKey(dateKey);
  const { hour, minute } = parseTimeKey(timeKey);
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(naiveUTC);
  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getOffsetMinutesForZone(guess, safeTimeZone);
    guess = new Date(naiveUTC - offsetMinutes * 60000);
  }
  return guess;
}

function addMinutesToTime(timeKey, minutesToAdd) {
  const { hour, minute } = parseTimeKey(timeKey);
  const total = hour * 60 + minute + minutesToAdd;
  const endHour = Math.floor(total / 60) % 24;
  const endMinute = total % 60;
  return `${pad(endHour)}:${pad(endMinute)}`;
}

function buildLocalDateTime(dateKey, timeKey) {
  parseDateKey(dateKey);
  parseTimeKey(timeKey);
  return `${dateKey}T${timeKey}:00`;
}

function buildSlotId(dateKey, timeKey) {
  return `${dateKey}_${timeKey.replace(':', '')}`;
}

function buildSlotLabel(startUTC, visitorTimeZone = ZACH_TIME_ZONE) {
  const safeVisitorTimeZone = normalizeTimeZone(visitorTimeZone);
  const centralDate = startUTC.toLocaleDateString('en-US', {
    timeZone: ZACH_TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const centralTime = startUTC.toLocaleTimeString('en-US', {
    timeZone: ZACH_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  const visitorTime = startUTC.toLocaleString('en-US', {
    timeZone: safeVisitorTimeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  return safeVisitorTimeZone === ZACH_TIME_ZONE
    ? `${centralDate} · ${centralTime}`
    : `${visitorTime} (${centralTime})`;
}

function getMinimumBookingTime(now = new Date()) {
  const chicagoWeekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: ZACH_TIME_ZONE }).format(now);
  const leadMinutes = chicagoWeekday === 'Friday' ? 30 : 8 * 60;
  return new Date(now.getTime() + leadMinutes * 60000);
}

function listCandidateSlots({ now = new Date(), visitorTimeZone = ZACH_TIME_ZONE } = {}) {
  const safeVisitorTimeZone = normalizeTimeZone(visitorTimeZone);
  const minBookingTime = getMinimumBookingTime(now);
  const slots = [];

  for (let d = 0; d < BOOKING_WINDOW_DAYS; d += 1) {
    const probeUTC = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const dateKey = getDateKeyInZone(probeUTC, ZACH_TIME_ZONE);
    const middayUTC = zonedWallTimeToUTC(dateKey, '12:00', ZACH_TIME_ZONE);
    const weekday = getWeekdayInZone(middayUTC, ZACH_TIME_ZONE);
    const times = AVAILABILITY[weekday] || [];

    for (const timeKey of times) {
      const startUTC = zonedWallTimeToUTC(dateKey, timeKey, ZACH_TIME_ZONE);
      const endUTC = new Date(startUTC.getTime() + SLOT_MINUTES * 60000);
      if (startUTC < minBookingTime) continue;
      slots.push({
        id: buildSlotId(dateKey, timeKey),
        dateKey,
        timeKey,
        startISO: startUTC.toISOString(),
        endISO: endUTC.toISOString(),
        label: buildSlotLabel(startUTC, safeVisitorTimeZone),
        centralLabel: buildSlotLabel(startUTC, ZACH_TIME_ZONE),
        visitorTimeZone: safeVisitorTimeZone,
      });
    }
  }

  // If daylight-saving duplicate date keys occur in the seven UTC probes, keep unique slots only.
  const seen = new Set();
  return slots.filter((slot) => {
    if (seen.has(slot.id)) return false;
    seen.add(slot.id);
    return true;
  });
}

function slotOverlapsBusy(slot, busy) {
  const start = new Date(slot.startISO);
  const end = new Date(slot.endISO);
  return busy.some((item) => start < item.end && end > item.start);
}

function filterAvailableSlots(slots, busyTimes) {
  return slots.filter((slot) => !slotOverlapsBusy(slot, busyTimes));
}

function findSlotOrThrow({ selectedDate, selectedTime, now = new Date(), visitorTimeZone = ZACH_TIME_ZONE }) {
  const safeVisitorTimeZone = normalizeTimeZone(visitorTimeZone);
  const slot = listCandidateSlots({ now, visitorTimeZone: safeVisitorTimeZone }).find(
    (candidate) => candidate.dateKey === selectedDate && candidate.timeKey === selectedTime
  );
  if (!slot) {
    const error = new Error('That time is no longer available. Pick another open time.');
    error.statusCode = 409;
    throw error;
  }
  return slot;
}

function normalizeBusyEvents(items = []) {
  return items
    .filter((event) => event.status !== 'cancelled')
    .map((event) => ({
      start: new Date(event.start?.dateTime || event.start?.date),
      end: new Date(event.end?.dateTime || event.end?.date),
      id: event.id,
      summary: event.summary,
    }))
    .filter((event) => !Number.isNaN(event.start.getTime()) && !Number.isNaN(event.end.getTime()));
}

function buildCalendarEventPayload({ firstName, lastName, email, schoolUrl, slot }) {
  const displayName = `${firstName} ${lastName}`.trim();
  const endTimeKey = addMinutesToTime(slot.timeKey, SLOT_MINUTES);
  return {
    summary: `Founder Call (Free) — ${displayName} — ZiroWork`,
    description: `ZiroWork Founder Call\n\nClient: ${displayName}\nEmail: ${email}\nWebsite: ${schoolUrl || 'Not provided'}\n\nBooked via book.zirowork.com/waitlist\nSlot: ${slot.dateKey} ${slot.timeKey} ${ZACH_TIME_ZONE}\nUTC: ${slot.startISO}`,
    start: { dateTime: buildLocalDateTime(slot.dateKey, slot.timeKey), timeZone: ZACH_TIME_ZONE },
    end: { dateTime: buildLocalDateTime(slot.dateKey, endTimeKey), timeZone: ZACH_TIME_ZONE },
    status: 'confirmed',
    visibility: 'default',
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
    attendees: [
      { email, displayName, responseStatus: 'needsAction' },
      { email: ADMIN_EMAIL, displayName: 'Admin', responseStatus: 'accepted' },
    ],
    conferenceData: {
      createRequest: {
        requestId: `zirowork-founder-${slot.id}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 100),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };
}

module.exports = {
  ZACH_TIME_ZONE,
  ADMIN_EMAIL,
  SLOT_MINUTES,
  BOOKING_WINDOW_DAYS,
  AVAILABILITY,
  addMinutesToTime,
  buildCalendarEventPayload,
  buildSlotId,
  buildSlotLabel,
  filterAvailableSlots,
  findSlotOrThrow,
  getMinimumBookingTime,
  listCandidateSlots,
  normalizeBusyEvents,
  normalizeTimeZone,
  parseDateKey,
  parseTimeKey,
  slotOverlapsBusy,
  zonedWallTimeToUTC,
};
