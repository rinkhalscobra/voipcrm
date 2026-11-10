insert into public.role_permissions(role,permission) values('company_admin','numbers.manage');
create or replace function private.company_access(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select private.active_user() and exists(select 1 from public.company_memberships m join public.companies x on x.id=m.company_id where m.user_id=auth.uid() and m.company_id=c and m.active and x.status in ('active','trial') and (m.role<>'company_admin' or coalesce(auth.jwt()->>'aal','')='aal2'))
$$;
create function public.assign_number_employee(p_did uuid,p_user uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.did_allocations; m public.company_memberships; v uuid; stamp timestamptz:=now();
begin
 perform 1 from public.did_numbers where id=p_did for update;
 select * into a from public.did_allocations where did_id=p_did and valid_to is null for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if not private.platform_permission('numbers.manage') and not private.company_permission(a.company_id,'numbers.manage') then raise exception 'FORBIDDEN'; end if;
 select * into m from public.company_memberships where company_id=a.company_id and user_id=p_user and active;
 if not found then raise exception 'INVALID_MEMBER'; end if;
 update public.did_allocations set valid_to=stamp where id=a.id;
 update public.caller_id_permissions set enabled=false where allocation_id=a.id;
 insert into public.did_allocations(did_id,company_id,user_id,manager_id,team_leader_id,monthly_price,valid_from) values(a.did_id,a.company_id,p_user,m.manager_id,m.team_leader_id,a.monthly_price,stamp) returning id into v;
 insert into public.audit_logs(company_id,actor_id,action,resource_id) values(a.company_id,auth.uid(),'number.employee_reassigned',p_did);
 return v;
end $$;
create function public.reassign_employee(p_company uuid,p_user uuid,p_department uuid,p_team uuid,p_manager uuid,p_leader uuid,p_active boolean) returns void language plpgsql security definer set search_path = '' as $$
declare a public.did_allocations; old public.company_memberships; stamp timestamptz:=now();
begin
 if not private.platform_permission('users.manage') and not private.company_permission(p_company,'users.manage') then raise exception 'FORBIDDEN'; end if;
 select * into old from public.company_memberships where company_id=p_company and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if old.role='company_admin' and not private.platform_permission('users.manage') then raise exception 'FORBIDDEN'; end if;
 if p_manager is not null and not exists(select 1 from public.company_memberships where company_id=p_company and user_id=p_manager and role='manager' and active) then raise exception 'INVALID_MEMBER'; end if;
 if p_leader is not null and not exists(select 1 from public.company_memberships where company_id=p_company and user_id=p_leader and role='team_leader' and active) then raise exception 'INVALID_MEMBER'; end if;
 update public.company_memberships set department_id=p_department,team_id=p_team,manager_id=p_manager,team_leader_id=p_leader,active=p_active where id=old.id;
 update public.team_memberships set valid_to=stamp where user_id=p_user and valid_to is null;
 if p_team is not null then insert into public.team_memberships(company_id,team_id,user_id,valid_from) values(p_company,p_team,p_user,stamp); end if;
 for a in select * from public.did_allocations where company_id=p_company and user_id=p_user and valid_to is null for update loop
 perform 1 from public.did_numbers where id=a.did_id for update;
 update public.did_allocations set valid_to=stamp where id=a.id;
 update public.caller_id_permissions set enabled=false where allocation_id=a.id;
 insert into public.did_allocations(did_id,company_id,user_id,manager_id,team_leader_id,monthly_price,valid_from) values(a.did_id,a.company_id,case when p_active then p_user else null end,p_manager,p_leader,a.monthly_price,stamp);
 end loop;
 insert into public.audit_logs(company_id,actor_id,action,resource_id) values(p_company,auth.uid(),'employee.reassigned',p_user);
end $$;
create unique index one_reversal_per_transaction on public.billing_adjustments(original_transaction_id);
create function public.reverse_wallet_transaction(p_transaction uuid,p_key text,p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare tx public.wallet_transactions; correction public.wallet_transactions; existing public.billing_adjustments;
begin
 if not private.platform_permission('finance.write') then raise exception 'FORBIDDEN'; end if;
 select * into tx from public.wallet_transactions where id=p_transaction for update;
 if not found or tx.type='reversal' then raise exception 'INVALID_REQUEST'; end if;
 select * into existing from public.billing_adjustments where original_transaction_id=p_transaction;
 if found then return existing.transaction_id; end if;
 correction:=public.wallet_post(tx.wallet_id,-tx.amount,'reversal',p_key,p_reason,tx.id);
 insert into public.billing_adjustments(company_id,transaction_id,original_transaction_id,reason) values(tx.company_id,correction.id,tx.id,p_reason);
 return correction.id;
end $$;
revoke all on function public.assign_number_employee(uuid,uuid),public.reassign_employee(uuid,uuid,uuid,uuid,uuid,uuid,boolean),public.reverse_wallet_transaction(uuid,text,text) from public,anon;
grant execute on function public.assign_number_employee(uuid,uuid),public.reassign_employee(uuid,uuid,uuid,uuid,uuid,uuid,boolean),public.reverse_wallet_transaction(uuid,text,text) to authenticated,service_role;
