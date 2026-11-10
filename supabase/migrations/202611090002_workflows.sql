create function public.create_company(p_name text,p_slug text,p_email text,p_country text,p_currency text) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
 if not private.platform_permission('companies.manage') then raise exception 'FORBIDDEN'; end if;
 insert into public.companies(name,slug,contact_email,country,currency) values(p_name,p_slug,p_email,p_country,p_currency) returning id into c;
 insert into public.customer_wallets(company_id,currency) values(c,p_currency);
 insert into public.audit_logs(actor_id,action,resource_id,company_id) values(auth.uid(),'company.created',c,c);
 return c;
end $$;
create function public.create_provider(p_id uuid,p_name text,p_currency text,p_ciphertext text) returns uuid language plpgsql security definer set search_path = '' as $$
begin
 if not private.platform_permission('providers.manage') then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-onboarding',0));
 if exists(select 1 from public.provider_accounts) and not exists(select 1 from public.provider_accounts where verified_resources @> array['balance','users','devices','dids','calls'] and not is_seed) then raise exception 'FIRST_ACCOUNT_UNVERIFIED'; end if;
 insert into public.provider_accounts(id,name,currency) values(p_id,p_name,p_currency);
 insert into private.provider_credentials(provider_account_id,ciphertext) values(p_id,p_ciphertext);
 insert into public.audit_logs(actor_id,action,resource_id) values(auth.uid(),'provider.created',p_id);
 return p_id;
end $$;
create function public.enqueue_provider_sync(p_id uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 if not private.platform_permission('providers.manage') then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.provider_accounts where id=p_id and status<>'disabled' and not is_seed) then raise exception 'NOT_FOUND'; end if;
 insert into public.sync_jobs(provider_account_id,resource) select p_id,r from unnest(array['balance','users','devices','dids','calls','statuses']) r on conflict do nothing;
 get diagnostics n=row_count;
 insert into public.audit_logs(actor_id,action,resource_id) values(auth.uid(),'provider.sync_enqueued',p_id);
 return n;
end $$;
create function public.renew_sync_lease(p_id uuid,p_token uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 update public.sync_jobs set locked_until=now()+interval '90 seconds' where id=p_id and lease_token=p_token and status='running' and locked_until>now();
 return found;
end $$;
create function public.create_pricing_version(p_company uuid,p_name text,p_currency text,p_rates jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare plan uuid; v uuid; r jsonb;
begin
 if not private.platform_permission('pricing.manage') then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.companies where id=p_company and currency=p_currency) then raise exception 'CURRENCY_MISMATCH'; end if;
 insert into public.pricing_plans(company_id,name,currency) values(p_company,p_name,p_currency) returning id into plan;
 insert into public.pricing_plan_versions(plan_id,version,rules) values(plan,1,jsonb_build_object('rates',p_rates)) returning id into v;
 for r in select * from jsonb_array_elements(p_rates) loop
 insert into public.destination_rates(version_id,prefix,per_minute,connection_fee,minimum_seconds,increment_seconds) values(v,r->>'prefix',(r->>'per_minute')::numeric,(r->>'connection_fee')::numeric,(r->>'minimum_seconds')::integer,(r->>'increment_seconds')::integer);
 end loop;
 insert into public.audit_logs(actor_id,action,resource_id,company_id) values(auth.uid(),'pricing.version_created',v,p_company);
 return v;
end $$;
create function public.issue_invoice(p_company uuid,p_currency text,p_start date,p_end date,p_due date,p_items jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; i jsonb; sub numeric; taxes numeric; inv_number text;
begin
 if not private.platform_permission('finance.write') then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.companies where id=p_company and currency=p_currency) then raise exception 'CURRENCY_MISMATCH'; end if;
 if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then raise exception 'INVALID_REQUEST'; end if;
 v:=gen_random_uuid(); inv_number:='INV-'||to_char(now(),'YYYYMM')||'-'||upper(substr(replace(v::text,'-',''),1,12));
 insert into public.invoices(id,company_id,number,currency,status,period_start,period_end,due_at) values(v,p_company,inv_number,p_currency,'draft',p_start,p_end,p_due);
 for i in select * from jsonb_array_elements(p_items) loop
 insert into public.invoice_items(company_id,invoice_id,description,quantity,unit_price,tax_percent) values(p_company,v,i->>'description',(i->>'quantity')::numeric,(i->>'unit_price')::numeric,(i->>'tax_percent')::numeric);
 end loop;
 select sum(round(quantity*unit_price,6)),sum(round(round(quantity*unit_price,6)*tax_percent/100,6)) into sub,taxes from public.invoice_items where invoice_id=v;
 update public.invoices set subtotal=sub,tax=taxes,total=sub+taxes,status='issued' where id=v;
 insert into public.audit_logs(actor_id,action,resource_id,company_id) values(auth.uid(),'invoice.issued',v,p_company);
 return v;
end $$;
create function public.record_payment(p_invoice uuid,p_amount numeric,p_currency text,p_reference text) returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; existing public.payments; v uuid; paid numeric;
begin
 if not private.platform_permission('finance.write') then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_reference,0));
 select * into inv from public.invoices where id=p_invoice for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if inv.currency<>p_currency then raise exception 'CURRENCY_MISMATCH'; end if;
 select * into existing from public.payments where reference=p_reference;
 if found then if existing.invoice_id<>p_invoice or existing.amount<>p_amount then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return existing.id; end if;
 if inv.status<>'issued' then raise exception 'INVALID_REQUEST'; end if;
 select coalesce(sum(amount),0) into paid from public.payments where invoice_id=p_invoice;
 if p_amount<=0 or p_amount<>round(p_amount,6) or paid+p_amount>inv.total then raise exception 'INVALID_REQUEST'; end if;
 insert into public.payments(company_id,invoice_id,amount,currency,reference,recorded_by) values(inv.company_id,p_invoice,p_amount,p_currency,p_reference,auth.uid()) returning id into v;
 if paid+p_amount=inv.total then update public.invoices set status='paid' where id=p_invoice; end if;
 insert into public.audit_logs(actor_id,action,resource_id,company_id) values(auth.uid(),'invoice.payment_recorded',v,inv.company_id);
 return v;
end $$;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_context(),public.my_numbers(),public.set_provider_secret(uuid,text),public.allocate_did(uuid,uuid,uuid,numeric),public.unallocate_did(uuid),public.wallet_post(uuid,numeric,text,text,text,uuid),public.rate_call(uuid,uuid),public.create_company(text,text,text,text,text),public.create_provider(uuid,text,text,text),public.enqueue_provider_sync(uuid),public.create_pricing_version(uuid,text,text,jsonb),public.issue_invoice(uuid,text,date,date,date,jsonb),public.record_payment(uuid,numeric,text,text) to authenticated;
grant execute on all functions in schema public to service_role;
