-- Provider operations remain blocked even if a stale process has an old environment.
create or replace function public.worker_provider_secret(p_id uuid) returns text language sql security definer set search_path = '' as $$
 select c.ciphertext from private.provider_credentials c join public.provider_accounts p on p.id=c.provider_account_id
 where c.provider_account_id=p_id and auth.role()='service_role' and not p.is_seed and not private.demo_mode()
$$;
create or replace function public.claim_sync_job() returns setof public.sync_jobs language plpgsql security definer set search_path = '' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 return query with job as (select j.id from public.sync_jobs j join public.provider_accounts p on p.id=j.provider_account_id where j.is_seed=private.demo_mode() and not p.is_seed and not private.demo_mode() and p.status<>'disabled' and ((j.status='pending' and j.run_after<=now()) or (j.status='running' and j.locked_until<now())) order by j.run_after for update of j skip locked limit 1)
 update public.sync_jobs j set status='running',attempts=attempts+1,locked_until=now()+interval '90 seconds',lease_token=gen_random_uuid() from job where j.id=job.id returning j.*;
end $$;
create or replace function public.renew_sync_lease(p_id uuid,p_token uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 update public.sync_jobs set locked_until=now()+interval '90 seconds' where id=p_id and lease_token=p_token and status='running' and locked_until>now() and is_seed=private.demo_mode() and not private.demo_mode();
 return found;
end $$;
