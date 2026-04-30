// api/book-waitlist.js — Vercel Serverless Function
// Handles: Google Calendar event → Kit subscriber with custom fields (NO payment)
// For: ZiroWork founding members booking their free 30-minute call

import { google } from 'googleapis';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const KIT_API_KEY = process.env.KIT_API_KEY || 'GDLeN7k0im3DEq3y-eydKg';
const ZACH_CALENDAR_ID = process.env.ZACH_CALENDAR_ID || 'primary';
const BOOKED_FOUNDER_CALL_TAG_ID = 19259104;

async function createCalendarEvent({ firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel }) {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const [year, month, day] = selectedDate.split('-').map(Number);
  const [hour, minute] = selectedTime.split(':').map(Number);
  const startDateTime = new Date(year, month - 1, day, hour, minute, 0);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const event = await calendar.events.insert({
    calendarId: ZACH_CALENDAR_ID,
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Founder Call (Free) — ${firstName} ${lastName} — ZiroWork`,
      description: `ZiroWork Founder Call — Free\n\nClient: ${firstName} ${lastName}\nEmail: ${email}\nWebsite: ${schoolUrl || 'Not provided'}\n\nBooked via book.zirowork.com/waitlist`,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Chicago' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Chicago' },
      attendees: [{ email: email, displayName: `${firstName} ${lastName}` }],
      conferenceData: {
        createRequest: {
          requestId: `zirowork-founder-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 1440 },
          { method: 'popup', minutes: 30 }
        ]
      }
    }
  });

  return event.data.conferenceData?.entryPoints?.[0]?.uri || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel } = req.body;

  if (!firstName || !lastName || !email || !selectedDate || !selectedTime) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    // STEP 1 — CREATE GOOGLE CALENDAR EVENT WITH MEET LINK
    const meetLink = await createCalendarEvent({ firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel });
    console.log('Founder call calendar event created. Meet link:', meetLink);

    // STEP 2 — SUBSCRIBE TO KIT WITH CUSTOM FIELDS + TAG
    await fetch(`https://api.convertkit.com/v3/tags/${BOOKED_FOUNDER_CALL_TAG_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KIT_API_KEY,
        email,
        first_name: firstName,
        fields: {
          meet_link: meetLink || '',
          session_date: selectedDateLabel,
          session_type: 'Founder Call (Free)'
        }
      })
    });

    console.log(`Founder call booked: ${firstName} ${lastName} <${email}> — ${selectedDateLabel}`);
    return res.status(200).json({ success: true, meetLink });

  } catch (err) {
    console.error('Waitlist booking handler error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or email zach@zirowork.com' });
  }
}
