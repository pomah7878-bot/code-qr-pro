import { db } from '../db.js';
import { sendMail, smtpConfigured, renderEmail } from './mailer.js';

let running = false;

function refreshCampaigns() {
  try {
    db.prepare(`
      UPDATE email_campaigns SET
        sent = (SELECT COUNT(*) FROM email_outbox WHERE campaign_id = email_campaigns.id AND status='sent'),
        failed = (SELECT COUNT(*) FROM email_outbox WHERE campaign_id = email_campaigns.id AND status='failed'),
        status = CASE
          WHEN EXISTS (SELECT 1 FROM email_outbox WHERE campaign_id = email_campaigns.id AND status='queued') THEN 'sending'
          ELSE 'done' END,
        finished_at = CASE
          WHEN EXISTS (SELECT 1 FROM email_outbox WHERE campaign_id = email_campaigns.id AND status='queued') THEN finished_at
          ELSE COALESCE(finished_at, datetime('now')) END
    `).run();
  } catch { /* журнал кампаний не должен ломать отправку */ }
}

export async function pumpMailQueue() {
  if (running || !smtpConfigured()) return;
  running = true;
  try {
    for (;;) {
      const row = db.prepare("SELECT * FROM email_outbox WHERE status='queued' ORDER BY id LIMIT 1").get();
      if (!row) break;
      try {
        const { html, text } = renderEmail(row.body, row.user_id);
        await sendMail({ to: row.to_email, subject: row.subject, text, html });
        db.prepare("UPDATE email_outbox SET status='sent', sent_at=datetime('now'), error=NULL WHERE id=?").run(row.id);
      } catch (e) {
        db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?")
          .run(String(e?.message || e).slice(0, 300), row.id);
      }
      refreshCampaigns();
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    running = false;
    refreshCampaigns();
  }
}

export function startMailQueue() {
  setTimeout(() => { pumpMailQueue().catch(() => {}); }, 3000).unref();
  setInterval(() => { pumpMailQueue().catch(() => {}); }, 30000).unref();
}
