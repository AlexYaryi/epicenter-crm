# Epicenter CRM Operations Runbook

## Daily owner checks

1. Open `/launch`.
   - Critical blockers must be `0`.
   - Insurance, Por Ror Bor / road tax and inspection are reminders, not rental blockers.

2. Open `/bookings`.
   - Only real bookings awaiting handover should be listed.
   - Active rentals must move to `/fleet?category=rented` and `/handover`.

3. Open `/handover`.
   - Check upcoming handovers, active rentals and return queue.
   - Returned/completed rentals should not remain in booking handover queue.

4. Open customer conversations.
   - Automatic booking/rental notifications are saved in `conversation_messages`.
   - Rows with `status = failed` need manual resend/check.

5. Check reminders.
   - Rental payment reminders run every 30 minutes on VPS.
   - Insurance / Por Ror Bor / inspection reminders run daily at 09:00 Bangkok time.

## VPS health checks

```bash
pm2 list
pm2 logs epicenter-crm --lines 100
systemctl status pm2-root
nginx -t
df -h /
crontab -l
```

Expected:
- `epicenter-crm` is `online`.
- `pm2-root` is `enabled` and `active`.
- `nginx -t` is successful.
- Disk usage should stay below 85%.

## Cron jobs

```cron
*/30 * * * * cd /var/www/epicenter-crm && /usr/bin/node tools/send_rental_reminders.js >> /var/log/epicenter-crm-reminders.log 2>&1
0 9 * * * cd /var/www/epicenter-crm && set -a && . ./.env.local && set +a && curl -fsS -H "x-epicenter-messaging-secret: $EPICENTER_MESSAGING_SECRET" "${NEXT_PUBLIC_APP_URL:-https://crm.phuketcar.rent}/api/compliance/reminders" >> /var/log/epicenter-crm-compliance-reminders.log 2>&1
```

## Deployment preflight

Always run before deployment:

```bash
npm run test:payment-status
npx tsc --noEmit
npm run build
```

Then deploy, restart PM2, and verify:

```bash
pm2 restart epicenter-crm
pm2 list
```

Check production:
- `/bookings`
- `/handover`
- `/fleet?category=rented`
- `/launch`

## Supabase hard rules

Applied:
- Old insurance hard-blocker removed by `docs/23_remove_insurance_handover_block.sql`.
- Vehicle overlap hard-lock exists:
  - `bookings_no_vehicle_overlap`
  - `bookings_prevent_vehicle_overlap`
  - `maintenance_prevent_booking_overlap`

Business rule:
- Insurance, Por Ror Bor / road tax and inspection can be renewed during a rental.
- They create reminders for owner/Thomas.
- They must not block booking, handover, active rental, or public advertising.

## Supabase backups

Checked on 2026-06-14 in Supabase Dashboard.

Current state:
- Scheduled database backups are enabled.
- Supabase states that projects are backed up daily around midnight in the project's region.
- Visible backups include physical backups for 07 Jun 2026 through 13 Jun 2026.
- Latest visible backup at check time: 13 Jun 2026 15:54:39 UTC.
- Point in Time Recovery is not enabled; Supabase shows it as a Pro Plan add-on.

Important limitation:
- Supabase database backups do not include Storage API objects.
- The database backup restores metadata only. Deleted uploaded files/photos/documents are not restored by database backup alone.

Operational rule:
- Before major production changes, confirm a fresh scheduled backup exists.
- For full disaster recovery, add a separate Storage backup/export process for customer documents, vehicle photos and uploaded media.
