// api/slots.js
// Returns available 30-minute booking slots for the next 7 days
// Checks Google Calendar for existing events and removes taken slots

const { google } = require('googleapis');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

const GOOGLE_CLIENT_ID = requireEnv('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = requireEnv('GOOGLE_CLIENT_SECRET');
const GOOGLE_REFRESH_TOKEN = requireEnv('GOOGLE_REFRESH_TOKEN');
const ZACH_CALENDAR_ID = process.env.ZACH_CALENDAR_ID || 'primary';

// Availability defined in America/Chicago time
// Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const AVAILABILITY = {
  1: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  2: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  3: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  4: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  5: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  6: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }],
};

// Convert a Chicago "YYYY-MM-DD HH:MM" string to a UTC Date object
function chicagoToUTC(dateStr, timeStr) {
  // Build a date string that JS can parse, then correct for Chicago offset
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // Create a Date in UTC at the given wall-clock time, then find the actual Chicago offset
  // We use a trick: format a known UTC time in Chicago tz and compare
  const approxUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  
  // Get what Chicago clock shows for this UTC time
  const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  
  // Find Chicago offset for this date by checking noon UTC
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const noonChicago = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(noonUTC);
  const noonChicagoHour = parseInt(noonChicago.split(':')[0]);
  // noon UTC in Chicago: if CDT (UTC-5) shows 7am, if CST (UTC-6) shows 6am
  const offsetHours = noonChicagoHour - 12; // e.g. 7 - 12 = -5 for CDT
  
  return new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0));
}

function getOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    'https://book.zirowork.com/api/auth/callback'
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // On Fridays, use 30-min buffer so same-day slots show; otherwise 8 hours
    const todayCST = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
    const minBookingTime = todayCST === 'Friday'
      ? new Date(now.getTime() + 30 * 60 * 1000)
      : new Date(now.getTime() + 8 * 60 * 60 * 1000);

    // Get existing calendar events
    const eventsRes = await calendar.events.list({
      calendarId: ZACH_CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const busyTimes = (eventsRes.data.items || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        start: new Date(e.start.dateTime || e.start.date),
        end: new Date(e.end.dateTime || e.end.date),
      }));

    const slots = [];

    for (let d = 0; d < 7; d++) {
      const date = new Date(now);
      date.setDate(now.getDate() + d);
      date.setHours(0, 0, 0, 0);

      // Get the YYYY-MM-DD date string in Chicago timezone
      const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD

      // Get day of week in Chicago timezone
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
      const dayMap = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
      const dayOfWeek = dayMap[dayName];

      const daySlots = AVAILABILITY[dayOfWeek];
      if (!daySlots) continue;

      for (const slot of daySlots) {
        const slotStartUTC = chicagoToUTC(dateStr, slot.start);
        const slotEndUTC = chicagoToUTC(dateStr, slot.end);

        if (slotStartUTC < minBookingTime) continue;

        const isBooked = busyTimes.some(busy =>
          slotStartUTC < busy.end && slotEndUTC > busy.start
        );

        if (!isBooked) {
          slots.push({
            id: `${dateStr}_${slot.start.replace(':', '')}`,
            startISO: slotStartUTC.toISOString(),
            endISO: slotEndUTC.toISOString(),
            displayDate: slotStartUTC.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' }),
            displayTime: slotStartUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CDT',
          });
        }
      }
    }

    return res.status(200).json({ slots });

  } catch (err) {
    console.error('Slots error:', err.message);
    return res.status(500).json({ error: 'Could not load available times. Please try again.' });
  }
};
