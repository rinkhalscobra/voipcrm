-- Public registration always creates a new company. Privileges and existing
-- company ownership are never accepted from editable Auth user metadata.
create or replace function private.on_auth_user_created() returns trigger language plpgsql security definer set search_path = '' as $$
declare invite public.user_invitations; company_name text; company_currency text; company_country text; company_id uuid; company_slug text; seed boolean;
begin
 insert into public.profiles(id,full_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),100));
 if new.raw_user_meta_data->>'invitation_id' is not null then
   select * into invite from public.user_invitations where id=(new.raw_user_meta_data->>'invitation_id')::uuid and lower(email)=lower(new.email) and accepted_at is null and expires_at>now() for update;
   if not found then raise exception 'INVALID_INVITATION'; end if;
   select is_seed into seed from public.companies where id=invite.company_id;
   update public.profiles set is_seed=seed where id=new.id;
   insert into public.company_memberships(company_id,user_id,role) values(invite.company_id,new.id,invite.role);
   update public.user_invitations set auth_user_id=new.id,accepted_at=now() where id=invite.id;
 elsif new.raw_user_meta_data ? 'registration_company_name' then
   if jsonb_typeof(new.raw_user_meta_data->'registration_company_name')<>'string' then raise exception 'INVALID_REGISTRATION'; end if;
   company_name:=btrim(new.raw_user_meta_data->>'registration_company_name');
   company_currency:=upper(coalesce(new.raw_user_meta_data->>'registration_currency','EUR'));
   company_country:=nullif(btrim(coalesce(new.raw_user_meta_data->>'registration_country','')),'');
   if length(company_name) not between 2 and 160 or company_currency !~ '^[A-Z]{3}$' or length(coalesce(company_country,''))>80 then raise exception 'INVALID_REGISTRATION'; end if;
   company_id:=gen_random_uuid(); seed:=private.demo_mode();
   company_slug:=coalesce(nullif(trim(both '-' from regexp_replace(lower(left(company_name,40)),'[^a-z0-9]+','-','g')),''),'company')||'-'||replace(company_id::text,'-','');
   insert into public.companies(id,name,slug,contact_name,contact_email,country,currency,status,is_seed)
   values(company_id,company_name,company_slug,left(coalesce(new.raw_user_meta_data->>'full_name',''),100),new.email,company_country,company_currency,'trial',seed);
   insert into public.customer_wallets(company_id,currency) values(company_id,company_currency);
   update public.profiles set is_seed=seed where id=new.id;
   insert into public.company_memberships(company_id,user_id,role) values(company_id,new.id,'company_admin');
   insert into public.audit_logs(company_id,actor_id,action,resource_id,metadata) values(company_id,new.id,'user.self_registered',new.id,'{"workspace":"new_company"}');
 end if;
 return new;
end $$;
revoke all on function private.on_auth_user_created() from public,anon,authenticated;
