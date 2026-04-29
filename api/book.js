// api/book.js — Vercel Serverless Function
// Handles: Square payment → Google Calendar event → Resend emails

import { google } from 'googleapis';

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Zach Adkins <zach@zirowork.com>';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'adkinsguitarandmusic@gmail.com';
const ZACH_CALENDAR_ID = process.env.ZACH_CALENDAR_ID || 'primary';

function buildConfirmationEmail(data, meetLink) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="padding:0 0 24px;border-bottom:1px solid #222;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0;font-size:13px;font-weight:700;letter-spacing:4px;color:#C5F135;text-transform:uppercase;">ZIROWORK</p></td>
      <td style="text-align:right;"><p style="margin:0;font-size:11px;color:#444;letter-spacing:2px;text-transform:uppercase;">Session Confirmed</p></td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:32px 0 24px;border-bottom:1px solid #222;">
    <h1 style="margin:0 0 8px;font-size:36px;font-weight:900;color:#fff;line-height:1.1;">You're Booked, ${data.firstName}. 🎸</h1>
    <p style="margin:0;font-size:16px;color:#777;">Your strategy session with Zach is confirmed.</p>
  </td></tr>

  <tr><td style="padding:24px 0;border-bottom:1px solid #222;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #222;">
      <tr><td style="padding:20px 24px;border-bottom:1px solid #222;">
        <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:3px;color:#C5F135;text-transform:uppercase;">Session Details</p>
      </td></tr>
      <tr><td style="padding:20px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#555;width:40%;">Date & Time</td>
            <td style="padding:8px 0;font-size:14px;color:#fff;font-weight:600;">${data.selectedDateLabel}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#555;">Duration</td>
            <td style="padding:8px 0;font-size:14px;color:#fff;">30 Minutes</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#555;">With</td>
            <td style="padding:8px 0;font-size:14px;color:#fff;">Zachary Adkins</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#555;">Format</td>
            <td style="padding:8px 0;font-size:14px;color:#fff;">Google Meet</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  ${meetLink ? `
  <tr><td style="padding:24px 0;border-bottom:1px solid #222;text-align:center;">
    <p style="margin:0 0 16px;font-size:13px;color:#555;letter-spacing:1px;text-transform:uppercase;">Your Google Meet Link</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#C5F135;">
      <a href="${meetLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:900;color:#080808;text-decoration:none;letter-spacing:1px;">JOIN THE MEETING →</a>
    </td></tr></table>
    <p style="margin:12px 0 0;font-size:12px;color:#444;">${meetLink}</p>
  </td></tr>` : ''}

  <tr><td style="padding:24px 0;border-bottom:1px solid #222;">
    <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:3px;color:#C5F135;text-transform:uppercase;">Come Prepared</p>
    <table cellpadding="0" cellspacing="0" width="100%">
      ${['Have your website open and ready to share screen','Know your current monthly student count','Know your current pricing per session','Think about your biggest enrollment challenge'].map(item => `
      <tr><td style="padding:6px 0;font-size:14px;color:#888;"><span style="color:#C5F135;margin-right:8px;">→</span>${item}</td></tr>`).join('')}
    </table>
  </td></tr>

  <tr><td style="padding:24px 0 0;">
    <p style="margin:0 0 8px;font-size:14px;color:#555;">Need to reschedule? Email me directly.</p>
    <p style="margin:0;font-size:14px;"><a href="mailto:adkinsguitarandmusic@gmail.com" style="color:#C5F135;">adkinsguitarandmusic@gmail.com</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:#444;">— Zach · I actually respond.</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  const { firstName, lastName, email, schoolUrl, selectedDate, selectedTime, selectedDateLabel, sourceId } = req.body;

  if (!firstName || !lastName || !email || !selectedDate || !selectedTime || !sourceId) {
    return res.status(400).json({error:'Missing required fields.'});
  }

  try {

    // STEP 1 — CHARGE SQUARE
    console.log('Processing Square payment...');
    console.log('sourceId:', sourceId);
    console.log('location_id:', SQUARE_LOCATION_ID);

    const squareRes = await fetch(`https://connect.squareup.com/v2/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-17'
      },
      body: JSON.stringify({
        source_id: sourceId,
        amount_money: { amount: 100, currency: 'USD' },
        location_id: SQUARE_LOCATION_ID,
        idempotency_key: `booking-${Date.now()}`,
        note: `Strategy Session — ${firstName} ${lastName}`
      })
    });

    const squareData = await squareRes.json();
    console.log('Square full response:', JSON.stringify(squareData));

    if (!squareRes.ok || squareData.payment?.status !== 'COMPLETED') {
      const errMsg = squareData.errors?.[0]?.detail || 'Payment failed.';
      console.error('Square error:', errMsg);
      return res.status(402).json({error: errMsg});
    }

    console.log('Payment successful:', squareData.payment.id);

    // STEP 2 — CREATE GOOGLE CALENDAR EVENT WITH MEET
    console.log('Creating calendar event...');
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

    const meetLink = event.data.conferenceData?.entryPoints?.[0]?.uri || null;
    console.log('Calendar event created. Meet link:', meetLink);

    // STEP 3 — SEND CONFIRMATION EMAIL TO CLIENT
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: `✅ You're Booked — Strategy Session ${selectedDateLabel}`,
        html: buildConfirmationEmail({ firstName, selectedDateLabel }, meetLink)
      })
    });

    console.log('Confirmation email sent to:', email);

    // STEP 4 — NOTIFY ZACH
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        subject: `🔥 New Booking: ${firstName} ${lastName} — ${selectedDateLabel}`,
        html: `<div style="font-family:sans-serif;padding:24px;background:#080808;color:#eee;">
          <h2 style="color:#C5F135;">New Strategy Session Booked</h2>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}" style="color:#C5F135;">${email}</a></p>
          <p><strong>Time:</strong> ${selectedDateLabel}</p>
          <p><strong>Website:</strong> ${schoolUrl ? `<a href="${schoolUrl}" style="color:#C5F135;">${schoolUrl}</a>` : 'Not provided'}</p>
          ${meetLink ? `<p><strong>Meet Link:</strong> <a href="${meetLink}" style="color:#C5F135;">${meetLink}</a></p>` : ''}
          <p><strong>Payment:</strong> $97.00 ✅</p>
        </div>`
      })
    });

    return res.status(200).json({ success: true, meetLink });

  } catch(err) {
    console.error('Booking handler error:', err);
    return res.status(500).json({ error: 'Server error. Please try again or email adkinsguitarandmusic@gmail.com' });
  }
}
