USE u627061298_database_crm;

-- ─── Interview Scheduled Email Template ──────────────────────────────────────

INSERT IGNORE INTO email_templates (slug, name, description, subject, body_html, variables) VALUES
(
  'interview_scheduled',
  'Interview Scheduled',
  'Sent to candidate when an interview round is scheduled from the Interview Scheduler.',
  'Interview Scheduled — {{round_name}} | Affixx Media',
  '<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#4E3629;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Interview Scheduled</h1>
          <p style="color:#d4c5bf;margin:6px 0 0;font-size:14px;">Affixx Media</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="color:#1e293b;font-size:15px;margin:0 0 20px;">Hi <strong>{{candidate_name}}</strong>,</p>
          <p style="color:#475569;font-size:14px;margin:0 0 24px;">
            We are pleased to inform you that your interview has been scheduled. Please find the details below:
          </p>
          <table style="width:100%;background:#f8f6f5;border-radius:8px;padding:4px;" cellpadding="12" cellspacing="0">
            <tr>
              <td style="color:#64748b;font-size:13px;width:120px;border-bottom:1px solid #e2e8f0;">Round</td>
              <td style="color:#1e293b;font-size:14px;font-weight:600;border-bottom:1px solid #e2e8f0;">{{round_name}}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Date</td>
              <td style="color:#1e293b;font-size:14px;font-weight:600;border-bottom:1px solid #e2e8f0;">{{scheduled_date}}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Time</td>
              <td style="color:#1e293b;font-size:14px;font-weight:600;border-bottom:1px solid #e2e8f0;">{{scheduled_time}}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Mode</td>
              <td style="color:#1e293b;font-size:14px;font-weight:600;border-bottom:1px solid #e2e8f0;">{{mode}}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;">Interviewer</td>
              <td style="color:#1e293b;font-size:14px;font-weight:600;">{{interviewer_name}}</td>
            </tr>
          </table>
          <p style="color:#475569;font-size:14px;margin:24px 0 8px;">
            Please be available on time. If you have any questions, reply to this email.
          </p>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;">
            Best regards,<br>Affixx Media HR Team
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  '["candidate_name", "round_name", "scheduled_date", "scheduled_time", "mode", "interviewer_name"]'
);
