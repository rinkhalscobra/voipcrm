-- A server-only Auth Admin update commits client details and login credentials
-- together. User-editable metadata cannot authorize this operation.
create function private.apply_client_account_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare operation jsonb; client public.clients; actor uuid; v_active boolean;
begin
  operation:=to_jsonb(new)->'raw_app_meta_data'->'voixel_client_edit';
  if operation is null or operation is not distinct from (to_jsonb(old)->'raw_app_meta_data'->'voixel_client_edit') then return new; end if;
  if jsonb_typeof(operation)<>'object' or (operation->>'id') is null then raise exception 'INVALID_REQUEST'; end if;
  actor:=(operation->>'actor_id')::uuid;
  if not exists(select 1 from public.profiles p where p.id=actor and not p.suspended and
    (p.platform_role='super_admin' or (p.platform_role='platform_admin' and exists(
      select 1 from public.user_permissions u where u.user_id=p.id and u.permission='users.manage' and u.granted))))
    then raise exception 'FORBIDDEN'; end if;
  select * into client from public.clients where id=(operation->>'client_id')::uuid and user_id=new.id for update;
  if not found or client.is_seed<>private.demo_mode() then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.profiles where id=new.id and platform_role is not null) then raise exception 'FORBIDDEN'; end if;
  if (operation->>'name') is null or length(btrim(operation->>'name')) not between 2 and 160
    or (operation->>'name') is distinct from (new.raw_user_meta_data->>'full_name')
    or (operation->>'email') is distinct from new.email
    or jsonb_typeof(operation->'active') is distinct from 'boolean'
    or jsonb_typeof(operation->'password_changed') is distinct from 'boolean'
    then raise exception 'INVALID_REQUEST'; end if;
  v_active:=(operation->>'active')::boolean;
  update public.clients set name=btrim(operation->>'name') where id=client.id;
  update public.profiles set full_name=btrim(operation->>'name'),suspended=not v_active where id=new.id;
  update public.company_memberships set active=v_active where company_id=client.company_id and user_id=new.id and role='client';
  if not found then raise exception 'INVALID_MEMBER'; end if;
  if not v_active then update public.caller_id_permissions set enabled=false where user_id=new.id; end if;
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(client.company_id,actor,'client.account_updated',client.id,jsonb_build_object(
      'name',btrim(operation->>'name'),'active',v_active,'email_changed',new.email is distinct from old.email,
      'password_changed',(operation->>'password_changed')::boolean));
  return new;
end $$;
revoke all on function private.apply_client_account_edit() from public,anon,authenticated,service_role;
create trigger apply_client_account_edit after update on auth.users
  for each row execute function private.apply_client_account_edit();

-- Keep names changed by the existing company administrator workflow in Auth too.
create or replace function public.update_client(p_client uuid,p_name text,p_active boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare client public.clients;
begin
  select * into client from public.clients where id=p_client for update;
  if not found or client.is_seed<>private.demo_mode() then raise exception 'NOT_FOUND'; end if;
  if not private.platform_permission('users.manage') and not private.company_permission(client.company_id,'users.manage') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 160 or p_active is null then raise exception 'INVALID_REQUEST'; end if;
  update public.clients set name=btrim(p_name) where id=p_client;
  update public.profiles set full_name=btrim(p_name) where id=client.user_id;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('full_name',btrim(p_name)) where id=client.user_id;
  update public.company_memberships set active=p_active where company_id=client.company_id and user_id=client.user_id and role='client';
  if not p_active then update public.caller_id_permissions set enabled=false where user_id=client.user_id; end if;
  insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata)
    values(client.company_id,auth.uid(),'client.updated',p_client,jsonb_build_object('name',btrim(p_name),'active',p_active));
  return p_client;
end $$;
