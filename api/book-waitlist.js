// api/book-waitlist.js — Vercel Serverless Function
// Handles: Google Calendar event → Kit subscriber with custom fields (NO payment)
// For: ZiroWork founding members booking their free 30-minute call
// FIX: Sets custom fields BEFORE applying tag so confirmation email has meet_link populated

import { google } from 'googleapis';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const KIT_API_KEY = process.env.KIT_API_KEY || 'GDLeN7k0im3DEq3y-eydKg';
const KIT_API_SECRET = process.env.KIT_API_SECRET || 'GjhqnBQxcGyPDYtuCyLYp8y3-t2pUDWF2KRhXxgmQ-g';
const ZACH_CALENDAR_ID = process.env.ZACH_CALENDAR_ID || 'primary';
const BOOKED_FOUNDER_CALL_TAG_ID = 19259104;
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

    // STEP 2 — UPSERT SUBSCRIBER WITH CUSTOM FIELDS (no tag yet)
    // Must set fields BEFORE applying tag so Kit confirmation email has meet_link populated
    const subscriberRes = await fetch(`https://api.convertkit.com/v3/subscribers`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    // Use the subscribe-to-form trick to upsert subscriber with fields only (no tag trigger)
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
          session_type: 'Founder Call (Free)'
        }
      })
    });

    // Small delay to ensure Kit has committed the custom fields before tag fires
    await new Promise(resolve => setTimeout(resolve, 800));

    // STEP 3 — APPLY TAG (triggers Kit Rule → Founder Call Confirmation sequence)
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

    // STEP 4 — NOTIFY ZACH via Kit broadcast to himself
    // Simple: subscribe Zach's email to a one-off tag or just send a direct fetch to a notification endpoint
    // Using Kit's tag subscribe to fire a plain notification — cheapest reliable method
    try {
      // Send notification email to Zach via a simple HTTPS fetch to a self-notification endpoint
      // We'll use Kit's API to send a broadcast — but simplest is just log + rely on Google Calendar
      // Instead: use fetch to send a plain email via the existing Kit sender
      const notifyBody = {
        api_secret: KIT_API_SECRET,
        subject: `New Founder Call Booked — ${firstName} ${lastName}`,
        content: `<p>New founder call booked.</p><p><strong>Name:</strong> ${firstName} ${lastName}<br><strong>Email:</strong> ${email}<br><strong>School:</strong> ${schoolUrl || 'Not provided'}<br><strong>Date:</strong> ${selectedDateLabel}<br><strong>Meet Link:</strong> <a href="${meetLink}">${meetLink}</a></p>`,
        description: `Booking notification — ${firstName} ${lastName}`,
        email_address: ZACH_NOTIFY_EMAIL,
        published: true,
        send_at: new Date().toISOString(),
        subscriber_filter: [{ all: [{ type: 'email_address', value: ZACH_NOTIFY_EMAIL }] }]
      };

      await fetch('https://api.convertkit.com/v3/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifyBody)
      });
    } catch (notifyErr) {
      console.error('Zach notification failed (non-blocking):', notifyErr.message);
    }

    console.log(`Founder call booked: ${firstName} ${lastName} <${email}> — ${selectedDateLabel}`);
    return res.status(200).json({ success: true, meetLink });

  } catch (err) {
    console.error('Waitlist booking handler error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or email zach@zirowork.com' });
  }
}
