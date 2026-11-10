-- Keep saved white-label settings aligned with the application branding.
update public.system_settings
set value=jsonb_set(value,'{platform_name}','"Voixel"'::jsonb,true),updated_at=now()
where key='branding' and jsonb_typeof(value)='object';
insert into public.audit_logs(action,metadata)
values('branding.updated','{"platform_name":"Voixel"}'::jsonb);
