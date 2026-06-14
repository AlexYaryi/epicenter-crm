-- Epicenter CRM: cleanup WhatsApp LID contacts that were previously saved as phone numbers.
-- Safe intent:
-- 1. Back up affected customer rows.
-- 2. Move the stable WhatsApp LID into customers.whatsapp.
-- 3. Clear customers.phone only when it exactly equals the numeric part of the LID.
-- 4. Do not touch normal phone-number customers.

create table if not exists whatsapp_lid_customer_cleanup_backup (
  backup_id uuid primary key default gen_random_uuid(),
  backed_up_at timestamptz not null default now(),
  customer_id uuid not null,
  full_name text,
  old_phone text,
  old_whatsapp text,
  old_source_detail text,
  lid_contact_handle text not null
);

with latest_lid_contact as (
  select distinct on (customer_id)
    customer_id,
    contact_handle,
    regexp_replace(contact_handle, '\D', '', 'g') as lid_digits
  from conversation_messages
  where channel = 'whatsapp'
    and direction = 'inbound'
    and customer_id is not null
    and lower(contact_handle) like '%@lid'
  order by customer_id, occurred_at desc
),
affected as (
  select
    c.id,
    c.full_name,
    c.phone,
    c.whatsapp,
    c.source_detail,
    l.contact_handle
  from customers c
  join latest_lid_contact l on l.customer_id = c.id
  where (c.phone = l.lid_digits or c.whatsapp = l.lid_digits)
)
insert into whatsapp_lid_customer_cleanup_backup (
  customer_id,
  full_name,
  old_phone,
  old_whatsapp,
  old_source_detail,
  lid_contact_handle
)
select
  id,
  full_name,
  phone,
  whatsapp,
  source_detail,
  contact_handle
from affected
where not exists (
  select 1
  from whatsapp_lid_customer_cleanup_backup b
  where b.customer_id = affected.id
    and b.lid_contact_handle = affected.contact_handle
);

with latest_lid_contact as (
  select distinct on (customer_id)
    customer_id,
    contact_handle,
    regexp_replace(contact_handle, '\D', '', 'g') as lid_digits
  from conversation_messages
  where channel = 'whatsapp'
    and direction = 'inbound'
    and customer_id is not null
    and lower(contact_handle) like '%@lid'
  order by customer_id, occurred_at desc
)
update customers c
set
  phone = case when c.phone = l.lid_digits then null else c.phone end,
  whatsapp = l.contact_handle,
  source_detail = case
    when c.source_detail is null or c.source_detail in ('incoming message', 'epicenter-wa-rest')
      then 'WhatsApp LID: ' || l.contact_handle
    else c.source_detail
  end,
  updated_at = now()
from latest_lid_contact l
where c.id = l.customer_id
  and (c.phone = l.lid_digits or c.whatsapp = l.lid_digits);

select
  count(*) as remaining_polluted_lid_customers
from customers c
join (
  select distinct on (customer_id)
    customer_id,
    regexp_replace(contact_handle, '\D', '', 'g') as lid_digits
  from conversation_messages
  where channel = 'whatsapp'
    and direction = 'inbound'
    and customer_id is not null
    and lower(contact_handle) like '%@lid'
  order by customer_id, occurred_at desc
) l on l.customer_id = c.id
where c.phone = l.lid_digits or c.whatsapp = l.lid_digits;
