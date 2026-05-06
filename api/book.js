// api/book.js — Vercel Serverless Function
// Handles: Square payment → Google Calendar event → Kit tag → Gmail SMTP instant confirmation + Zach notification

const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const KIT_API_KEY = process.env.KIT_API_KEY || 'GDLeN7k0im3DEq3y-eydKg';
const ZACH_CALENDAR_ID = process.env.ZACH_CALENDAR_ID || 'primary';
const BOOKED_SESSION_TAG_ID = 19259103;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const ZACH_EMAIL = 'zach@adkinsenterprisesllc.com, admin@adkinsenterprisesllc.com';

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

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

module.exports = async function handler(req, res) {
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

    // STEP 3 — TAG IN KIT (CRM tracking only)
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

    // STEP 4 — SEND INSTANT CONFIRMATION EMAIL TO BOOKER VIA GMAIL SMTP
    const transporter = createTransporter();

    await transporter.sendMail({
      from: `"Zach Adkins | ZiroWork" <${GMAIL_USER}>`,
      to: email,
      subject: `Your Strategy Session is confirmed — ${selectedDateLabel}`,
      text: `Hey ${firstName},

You're locked in. Payment received.

Here's your Google Meet link for our session:
${meetLink}

Date: ${selectedDateLabel}

You'll also get a Google Calendar invite at this email address — accept it and the Meet link will be in there too.

Before we talk:
- Have your website URL ready
- Know your current student count and monthly revenue
- Have screen share working

That's it. I'll handle the rest.

If you need to reschedule, email me at least 4 hours before: zach@zirowork.com

See you then.
— Zach`,
      html: `<p>Hey ${firstName},</p>
<p>You're locked in. Payment received.</p>
<p>Here's your Google Meet link for our session:<br>
<a href="${meetLink}">${meetLink}</a></p>
<p><strong>Date:</strong> ${selectedDateLabel}</p>
<p>You'll also get a Google Calendar invite at this email address — accept it and the Meet link will be in there too.</p>
<p><strong>Before we talk:</strong><br>
- Have your website URL ready<br>
- Know your current student count and monthly revenue<br>
- Have screen share working</p>
<p>That's it. I'll handle the rest.</p>
<p>If you need to reschedule, email me at least 4 hours before: zach@zirowork.com</p>
<p>See you then.<br>— Zach</p>`
    });

    // STEP 5 — NOTIFY ZACH
    await transporter.sendMail({
      from: `"ZiroWork Booking" <${GMAIL_USER}>`,
      to: ZACH_EMAIL,
      subject: `New Strategy Session Booked — ${firstName} ${lastName} ($97)`,
      text: `New paid strategy session booked.

Name: ${firstName} ${lastName}
Email: ${email}
School: ${schoolUrl || 'Not provided'}
Date: ${selectedDateLabel}
Meet Link: ${meetLink}`
    });

    console.log(`Strategy session booked and confirmed: ${firstName} ${lastName} <${email}> — ${selectedDateLabel}`);
    return res.status(200).json({ success: true, meetLink });

  } catch (err) {
    console.error('Booking handler error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or email zach@zirowork.com' });
  }
}
