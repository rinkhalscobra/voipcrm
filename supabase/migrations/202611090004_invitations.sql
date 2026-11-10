create function private.on_auth_user_created() returns trigger language plpgsql security definer set search_path = '' as $$
declare invite public.user_invitations;
begin
 insert into public.profiles(id,full_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),100));
 if new.raw_user_meta_data->>'invitation_id' is not null then
 select * into invite from public.user_invitations where id=(new.raw_user_meta_data->>'invitation_id')::uuid and lower(email)=lower(new.email) and accepted_at is null and expires_at>now() for update;
 if not found then raise exception 'INVALID_INVITATION'; end if;
 insert into public.company_memberships(company_id,user_id,role) values(invite.company_id,new.id,invite.role);
 update public.user_invitations set auth_user_id=new.id,accepted_at=now() where id=invite.id;
 end if;
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.on_auth_user_created();
revoke all on function private.on_auth_user_created() from public,anon,authenticated;
