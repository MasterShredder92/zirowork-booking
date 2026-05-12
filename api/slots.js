// api/slots.js
// Returns available booking slots using the same source-of-truth rules as booking creation.

const { google } = require('googleapis');
const {
  ZACH_TIME_ZONE,
  filterAvailableSlots,
  listCandidateSlots,
  normalizeBusyEvents,
} = require('./schedule-core');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

const GOOGLE_CLIENT_ID = requireEnv('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = requireEnv('GOOGLE_CLIENT_SECRET');
const GOOGLE_REFRESH_TOKEN = requireEnv('GOOGLE_REFRESH_TOKEN');
const ZACH_CALENDAR_ID = requireEnv('ZACH_CALENDAR_ID');

function getOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const visitorTimeZone = req.query?.visitorTimeZone || req.query?.timeZone || ZACH_TIME_ZONE;
    const candidateSlots = listCandidateSlots({ visitorTimeZone });

    if (candidateSlots.length === 0) {
      return res.status(200).json({ slots: [] });
    }

    const auth = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const eventsRes = await calendar.events.list({
      calendarId: ZACH_CALENDAR_ID,
      timeMin: candidateSlots[0].startISO,
      timeMax: candidateSlots[candidateSlots.length - 1].endISO,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
    });

    const busyTimes = normalizeBusyEvents(eventsRes.data.items || []);
    const slots = filterAvailableSlots(candidateSlots, busyTimes);

    return res.status(200).json({ slots });
  } catch (err) {
    console.error('Slots error:', err.message);
    return res.status(500).json({ error: 'Could not load available times. Please try again.' });
  }
};
