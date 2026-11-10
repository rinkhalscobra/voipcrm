create function public.mark_provider_resource_verified(p_provider uuid,p_resource text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
 update public.provider_accounts set verified_resources=(select array_agg(distinct r) from unnest(verified_resources||array[p_resource]) r),last_successful_sync=now(),last_error_code=null where id=p_provider;
 update public.provider_accounts set status='active' where id=p_provider and status<>'disabled' and verified_resources @> array['balance','users','devices','dids','calls'];
end $$;
revoke all on function public.mark_provider_resource_verified(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_provider_resource_verified(uuid,text) to service_role;
