// api/book-waitlist.js — Vercel Serverless Function
// Handles: real availability check → Google Calendar event → Kit tag → Gmail confirmations.

const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const {
  ZACH_TIME_ZONE,
  buildCalendarEventPayload,
  filterAvailableSlots,
  findSlotOrThrow,
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
const KIT_API_KEY = process.env.KIT_API_KEY || '';
const KIT_API_SECRET = process.env.KIT_API_SECRET || '';
const ZACH_CALENDAR_ID = requireEnv('ZACH_CALENDAR_ID');
const BOOKED_FOUNDER_CALL_TAG_ID = 19259104;
const GMAIL_USER = requireEnv('GMAIL_USER');
const GMAIL_APP_PASSWORD = requireEnv('GMAIL_APP_PASSWORD');
const ADMIN_EMAIL = 'admin@adkinsenterprisesllc.com';

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function assertSlotStillAvailable(calendar, slot) {
  const eventsRes = await calendar.events.list({
    calendarId: ZACH_CALENDAR_ID,
    timeMin: slot.startISO,
    timeMax: slot.endISO,
    singleEvents: true,
    orderBy: 'startTime',
    showDeleted: false,
  });
  const busyTimes = normalizeBusyEvents(eventsRes.data.items || []);
  if (filterAvailableSlots([slot], busyTimes).length !== 1) {
    const error = new Error('That time was just booked. Pick another open time.');
    error.statusCode = 409;
    throw error;
  }
}

async function verifyCalendarEvent(calendar, eventId) {
  const verify = await calendar.events.get({
    calendarId: ZACH_CALENDAR_ID,
    eventId,
  });

  if (verify.data.status === 'cancelled') {
    throw new Error(`Event ${eventId} was created but came back cancelled`);
  }

  console.log(`Event verified: ${eventId} | status: ${verify.data.status} | start: ${verify.data.start?.dateTime}`);
}

async function createCalendarEvent({ firstName, lastName, email, schoolUrl, selectedDate, selectedTime, visitorTimeZone }) {
  const calendar = getCalendarClient();
  const slot = findSlotOrThrow({ selectedDate, selectedTime, visitorTimeZone: visitorTimeZone || ZACH_TIME_ZONE });
  await assertSlotStillAvailable(calendar, slot);

  const event = await calendar.events.insert({
    calendarId: ZACH_CALENDAR_ID,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: buildCalendarEventPayload({ firstName, lastName, email, schoolUrl, slot }),
  });

  const eventId = event.data.id;
  await verifyCalendarEvent(calendar, eventId);

  return {
    meetLink: event.data.conferenceData?.entryPoints?.[0]?.uri || null,
    eventId,
    slot,
  };
}

async function sendEmail(transporter, message, context) {
  try {
    await transporter.sendMail(message);
  } catch (err) {
    console.error(`[email] ${context} failed:`, err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel, visitorTimeZone } = req.body || {};

  if (!firstName || !lastName || !email || !selectedDate || !selectedTime) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const { meetLink, eventId, slot } = await createCalendarEvent({
      firstName,
      lastName,
      email,
      schoolUrl,
      selectedDate,
      selectedTime,
      visitorTimeZone: visitorTimeZone || ZACH_TIME_ZONE,
    });

    const label = selectedDateLabel || slot.label || slot.centralLabel;

    if (KIT_API_KEY) {
      try {
        await fetch(`https://api.convertkit.com/v3/tags/${BOOKED_FOUNDER_CALL_TAG_ID}/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: KIT_API_KEY,
            email,
            first_name: firstName,
            fields: {
              meet_link: meetLink || '',
              session_date: label,
              session_type: 'Founder Call (Free)',
              calendar_event_id: eventId,
              slot_start_utc: slot.startISO,
              visitor_time_zone: slot.visitorTimeZone,
            },
          }),
        });
      } catch (kitErr) {
        console.error('[kit] Waitlist booking tag failed:', kitErr.message, { email, eventId, kitSecretConfigured: Boolean(KIT_API_SECRET) });
      }
    } else {
      console.warn('[kit] Waitlist booking tag skipped: KIT_API_KEY not configured', { email, eventId, kitSecretConfigured: Boolean(KIT_API_SECRET) });
    }

    const transporter = createTransporter();

    await sendEmail(transporter, {
      from: `"Zach Adkins | ZiroWork" <${GMAIL_USER}>`,
      to: email,
      subject: `Your Founder Call is confirmed — ${label}`,
      text: `Hey ${firstName},

You're locked in.

Here's your Google Meet link for our call:
${meetLink}

Date: ${label}

You'll also get a Google Calendar invite at this email address. Accept it and the Meet link will be in there too.

Before we talk:
- Have your website URL ready
- Know your current student count
- Have screen share working

If you need to reschedule, email me at least 4 hours before: zach@zirowork.com

See you then.
— Zach`,
      html: `<p>Hey ${firstName},</p>
<p>You're locked in.</p>
<p>Here's your Google Meet link for our call:<br><a href="${meetLink}">${meetLink}</a></p>
<p><strong>Date:</strong> ${label}</p>
<p>You'll also get a Google Calendar invite at this email address. Accept it and the Meet link will be in there too.</p>
<p><strong>Before we talk:</strong><br>
- Have your website URL ready<br>
- Know your current student count<br>
- Have screen share working</p>
<p>If you need to reschedule, email me at least 4 hours before: zach@zirowork.com</p>
<p>See you then.<br>— Zach</p>`,
    }, `waitlist customer confirmation for ${email} / ${eventId}`);

    await sendEmail(transporter, {
      from: `"ZiroWork Booking" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `New Founder Call Booked — ${firstName} ${lastName}`,
      text: `New founder call booked.

Name: ${firstName} ${lastName}
Email: ${email}
School: ${schoolUrl || 'Not provided'}
Date: ${label}
Meet Link: ${meetLink}
Calendar Event ID: ${eventId}
Calendar: ${ZACH_CALENDAR_ID}
Slot UTC: ${slot.startISO}
Visitor TZ: ${slot.visitorTimeZone}`,
    }, `waitlist admin notification for ${email} / ${eventId}`);

    console.log(`Founder call booked: ${firstName} ${lastName} <${email}> | ${slot.id} | eventId: ${eventId}`);
    return res.status(200).json({ success: true, meetLink, eventId, slot });
  } catch (err) {
    console.error('Waitlist booking handler error:', err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      error: statusCode === 409 ? err.message : 'Server error. Please try again or email zach@zirowork.com',
    });
  }
};
