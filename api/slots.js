// api/slots.js
// Returns available 30-minute booking slots for the next 7 days
// Checks Google Calendar for existing events and removes taken slots

const { google } = require('googleapis');

// Availability defined in CST
// Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const AVAILABILITY = {
  1: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  2: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  3: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  4: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }, { start: '19:00', end: '19:30' }],
  6: [{ start: '10:00', end: '10:30' }, { start: '11:00', end: '11:30' }, { start: '15:00', end: '15:30' }],
};

function getOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://book.zirowork.com/api/auth/callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const minBookingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);

    // Get existing calendar events
    const eventsRes = await calendar.events.list({
      calendarId: 'primary',
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

      // Get CST day of week
      const cstDateStr = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
      const dayMap = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
      const dayOfWeek = dayMap[cstDateStr];

      const daySlots = AVAILABILITY[dayOfWeek];
      if (!daySlots) continue;

      for (const slot of daySlots) {
        const [sh, sm] = slot.start.split(':').map(Number);
        const [eh, em] = slot.end.split(':').map(Number);

        // Build slot time in CST by creating a date string
        const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD in CST
        const slotStartStr = `${dateStr}T${slot.start}:00`;
        const slotEndStr = `${dateStr}T${slot.end}:00`;

        // Convert CST string to UTC
        const slotStart = new Date(new Date(slotStartStr).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const slotEnd = new Date(new Date(slotEndStr).toLocaleString('en-US', { timeZone: 'America/Chicago' }));

        // Use simpler approach: build UTC times directly
        const cstOffset = -6 * 60; // CST is UTC-6
        const localOffset = date.getTimezoneOffset();
        
        const slotStartLocal = new Date(date);
        slotStartLocal.setHours(sh, sm, 0, 0);
        const slotStartUTC = new Date(slotStartLocal.getTime() + (cstOffset - (-localOffset)) * 60000);
        
        const slotEndLocal = new Date(date);
        slotEndLocal.setHours(eh, em, 0, 0);
        const slotEndUTC = new Date(slotEndLocal.getTime() + (cstOffset - (-localOffset)) * 60000);

        if (slotStartUTC < minBookingTime) continue;

        const isBooked = busyTimes.some(busy =>
          slotStartUTC < busy.end && slotEndUTC > busy.start
        );

        if (!isBooked) {
          slots.push({
            id: `${date.toISOString().split('T')[0]}_${slot.start.replace(':', '')}`,
            startISO: slotStartUTC.toISOString(),
            endISO: slotEndUTC.toISOString(),
            displayDate: slotStartUTC.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' }),
            displayTime: slotStartUTC.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CST',
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
