-- 20261025_business_phone_normalise.sql
-- Backfill business_customers.phone, business_workspaces.phone, and whatsapp_sessions.phone_number
-- to +91XXXXXXXXXX format using the exact rules of the JavaScript normaliser.

create or replace function public.normalise_phone_e164(raw text)
returns text language plpgsql immutable as $$
declare
  cleaned text;
  digits text;
begin
  if raw is null or trim(raw) = '' then
    return raw;
  end if;

  -- Strip spaces, dashes, parentheses, dots
  cleaned := regexp_replace(trim(raw), '[\s\-\(\)\.]+', '', 'g');
  if cleaned ilike 'whatsapp:%' then
    cleaned := substring(cleaned from 10);
  end if;

  if cleaned is null or cleaned = '' then
    return raw;
  end if;

  -- Leading plus: retain plus and remaining digits
  if cleaned like '+%' then
    digits := regexp_replace(substring(cleaned from 2), '\D', '', 'g');
    if digits is null or digits = '' then
      return raw;
    end if;
    return '+' || digits;
  end if;

  digits := regexp_replace(cleaned, '\D', '', 'g');
  if digits is null or digits = '' then
    return raw;
  end if;

  -- 10-digit Indian number: prefix +91
  if length(digits) = 10 then
    return '+91' || digits;
  -- 11 digits starting with 0: replace leading 0 with +91
  elsif length(digits) = 11 and digits like '0%' then
    return '+91' || substring(digits from 2);
  -- 12 digits starting with 91: prefix +
  elsif length(digits) = 12 and digits like '91%' then
    return '+' || digits;
  -- More than 10 digits: prefix +
  elsif length(digits) > 10 then
    return '+' || digits;
  else
    -- Unparseable / short numbers: leave unchanged
    return raw;
  end if;
end;
$$;

-- 1. Backfill business_customers.phone
update public.business_customers
set phone = public.normalise_phone_e164(phone)
where phone is not null and phone != '';

-- 2. Backfill business_workspaces.phone
update public.business_workspaces
set phone = public.normalise_phone_e164(phone)
where phone is not null and phone != '';

-- 3. Backfill whatsapp_sessions.phone_number
update public.whatsapp_sessions
set phone_number = public.normalise_phone_e164(phone_number)
where phone_number is not null and phone_number != '';
