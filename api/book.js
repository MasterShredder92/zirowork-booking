// api/book.js — Vercel Serverless Function
// Handles: Square payment → Google Calendar event → Kit subscriber with custom fields
// FIX: Sets custom fields BEFORE applying tag so confirmation email has meet_link populated

import { google } from 'googleapis';

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const KIT_API_KEY = process.env.KIT_API_KEY || 'GDLeN7k0im3DEq3y-eydKg';
const KIT_API_SECRET = process.env.KIT_API_SECRET || 'GjhqnBQxcGyPDYtuCyLYp8y3-t2pUDWF2KRhXxgmQ-g';
const ZACH_CALENDAR_ID = process.env.ZACH_CALENDAR_ID || 'primary';
const BOOKED_SESSION_TAG_ID = 19259103;
const ZACH_NOTIFY_EMAIL = 'zach@adkinsenterprisesllc.com';

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
      summary: `Strategy Session — ${firstName} ${lastName} — ZiroWork`,
      description: `Music School Strategy Session\n\nClient: ${firstName} ${lastName}\nEmail: ${email}\nWebsite: ${schoolUrl || 'Not provided'}\n\nBooked via book.zirowork.com`,
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Chicago' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Chicago' },
      attendees: [{ email: email, displayName: `${firstName} ${lastName}` }],
      conferenceData: {
        createRequest: {
          requestId: `zirowork-${Date.now()}`,
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

  const { firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel, sourceId } = req.body;

  if (!firstName || !lastName || !email || !selectedDate || !selectedTime || !sourceId) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    // STEP 1 — CHARGE SQUARE
    const squareRes = await fetch('https://connect.squareup.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-17'
      },
      body: JSON.stringify({
        source_id: sourceId,
        amount_money: { amount: 9700, currency: 'USD' },
        location_id: SQUARE_LOCATION_ID,
        idempotency_key: `booking-${Date.now()}`,
        note: `Strategy Session — ${firstName} ${lastName}`
      })
    });

    const squareData = await squareRes.json();
    if (!squareRes.ok || squareData.payment?.status !== 'COMPLETED') {
      const errMsg = squareData.errors?.[0]?.detail || 'Payment failed.';
      return res.status(402).json({ error: errMsg });
    }

    // STEP 2 — CREATE GOOGLE CALENDAR EVENT WITH MEET LINK
    const meetLink = await createCalendarEvent({ firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel });
    console.log('Calendar event created. Meet link:', meetLink);

    // STEP 3 — UPSERT SUBSCRIBER WITH CUSTOM FIELDS FIRST (no tag yet)
    // Must set fields BEFORE applying tag so Kit confirmation email has meet_link populated
    await fetch(`https://api.convertkit.com/v3/subscribers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_secret: KIT_API_SECRET,
        email,
        first_name: firstName,
        fields: {
          meet_link: meetLink || '',
          session_date: selectedDateLabel,
          session_type: 'Strategy Session ($97)'
        }
      })
    });

    // Small delay to ensure Kit has committed the custom fields before tag fires
    await new Promise(resolve => setTimeout(resolve, 800));

    // STEP 4 — APPLY TAG (triggers Kit Rule → Strategy Session Confirmation sequence)
    await fetch(`https://api.convertkit.com/v3/tags/${BOOKED_SESSION_TAG_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KIT_API_KEY,
        email,
        first_name: firstName,
        fields: {
          meet_link: meetLink || '',
          session_date: selectedDateLabel,
          session_type: 'Strategy Session ($97)'
        }
      })
    });

    // STEP 5 — NOTIFY ZACH
    try {
      await fetch('https://api.convertkit.com/v3/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_secret: KIT_API_SECRET,
          subject: `New Strategy Session Booked — ${firstName} ${lastName}`,
          content: `<p>New paid strategy session booked.</p><p><strong>Name:</strong> ${firstName} ${lastName}<br><strong>Email:</strong> ${email}<br><strong>School:</strong> ${schoolUrl || 'Not provided'}<br><strong>Date:</strong> ${selectedDateLabel}<br><strong>Meet Link:</strong> <a href="${meetLink}">${meetLink}</a></p>`,
          description: `Booking notification — ${firstName} ${lastName}`,
          published: true,
          send_at: new Date().toISOString(),
          subscriber_filter: [{ all: [{ type: 'email_address', value: ZACH_NOTIFY_EMAIL }] }]
        })
      });
    } catch (notifyErr) {
      console.error('Zach notification failed (non-blocking):', notifyErr.message);
    }

    console.log(`Booked: ${firstName} ${lastName} <${email}> — ${selectedDateLabel}`);
    return res.status(200).json({ success: true, meetLink });

  } catch (err) {
    console.error('Booking handler error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or email zach@zirowork.com' });
  }
}
