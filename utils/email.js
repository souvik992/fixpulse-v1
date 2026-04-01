const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendAssigneeNotification({ assigneeEmail, assigneeName, reporterName, bug, appUrl }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return; // silently skip if not configured

  const priorityColor = {
    Critical: '#ef4444',
    High:     '#f97316',
    Medium:   '#f59e0b',
    Low:      '#10b981',
  }[bug.priority] || '#6366f1';

  const issueUrl = `${appUrl || 'http://localhost:3000'}`;

  await getTransporter().sendMail({
    from: `"FixPulseHQ" <${process.env.SMTP_USER}>`,
    to:   assigneeEmail,
    subject: `[${bug.key}] You've been assigned: ${bug.title}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:8px;">
        <div style="background:#6366f1;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;">
          <h2 style="margin:0;font-size:18px;">FixPulseHQ - Bug Tracker</h2>
        </div>
        <div style="background:#fff;padding:24px;border-radius:0 0 6px 6px;border:1px solid #e5e7eb;border-top:none;">
          <p style="margin:0 0 12px;">Hi <strong>${assigneeName}</strong>,</p>
          <p style="margin:0 0 20px;">You've been assigned a new issue by <strong>${reporterName}</strong>.</p>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;width:120px;border-radius:4px 0 0 0;">Issue</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${bug.key} – ${bug.title}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;">Type</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${bug.type}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;">Priority</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
                <span style="color:${priorityColor};font-weight:600;">${bug.priority}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;">Status</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${bug.status}</td>
            </tr>
            ${bug.description ? `
            <tr>
              <td style="padding:8px 12px;background:#f3f4f6;font-weight:600;vertical-align:top;">Description</td>
              <td style="padding:8px 12px;">${bug.description}</td>
            </tr>` : ''}
          </table>

          <a href="${issueUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
            View in FixPulseHQ
          </a>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px;">
          You received this email because you were assigned to an issue on FixPulseHQ.
        </p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail({ toEmail, toName, resetUrl }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  await getTransporter().sendMail({
    from: `"FixPulseHQ" <${process.env.SMTP_USER}>`,
    to:   toEmail,
    subject: 'Reset your FixPulseHQ password',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:8px;">
        <div style="background:#6366f1;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;">
          <h2 style="margin:0;font-size:18px;">FixPulseHQ - Bug Tracker</h2>
        </div>
        <div style="background:#fff;padding:24px;border-radius:0 0 6px 6px;border:1px solid #e5e7eb;border-top:none;">
          <p style="margin:0 0 12px;">Hi <strong>${toName}</strong>,</p>
          <p style="margin:0 0 20px;">We received a request to reset your password. Click the button below to set a new one. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">
            Reset Password
          </a>
          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
            If you didn't request this, you can safely ignore this email. Your password won't change.
          </p>
          <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">
            Or copy this link: <a href="${resetUrl}" style="color:#6366f1;">${resetUrl}</a>
          </p>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px;">
          FixPulseHQ - Bug Tracker
        </p>
      </div>
    `,
  });
}

module.exports = { sendAssigneeNotification, sendPasswordResetEmail };
