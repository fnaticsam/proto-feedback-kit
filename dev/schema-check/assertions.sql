-- Test helpers are invoker functions: role anon must use the public API itself.
create function public.schema_check_assert(ok boolean, label text) returns void
language plpgsql set search_path = '' as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'SCHEMA_CHECK_PASS %', label;
end $$;
create function public.schema_check_error(statement text, expected text, label text) returns void
language plpgsql set search_path = '' as $$
declare actual text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual = returned_sqlstate;
  end;
  perform public.schema_check_assert(actual = expected, label || ' (SQLSTATE ' || expected || ')');
end $$;

select public.schema_check_assert((select count(*) = 2 from pf.docs where project = 'sprout'), 'seeded comment and reply survived');
select public.schema_check_assert((select name = 'Original Owner' from pf.names where project = 'sprout' and author = 'owner'), 'seeded owner name survived');
select public.schema_check_assert(pf.owner_of('sprout', null) is null and pf.owner_of('sprout', '') is null, 'null and empty owner keys grant nothing');
select public.schema_check_assert(pf.author_of(repeat('r', 32)) ~ '^a_[0-9a-f]{20}$' and pf.author_of('owner' || repeat('r', 32)) !~ '^owner', 'reviewer author cannot impersonate owners');
select public.schema_check_assert(not has_schema_privilege('anon', 'pf', 'USAGE') and not has_schema_privilege('authenticated', 'pf', 'USAGE'), 'private schema unavailable to API roles');
select public.schema_check_assert(not has_table_privilege('anon', 'pf.owner_keys', 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', 'pf.owner_keys', 'SELECT,INSERT,UPDATE,DELETE'), 'owner keys have no API table grants');
select public.schema_check_assert(not has_function_privilege('anon', 'pf.owner_of(text,text)', 'EXECUTE') and not has_function_privilege('authenticated', 'pf.owner_of(text,text)', 'EXECUTE'), 'owner lookup helper is private');
select public.schema_check_assert((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('pf_list', 'pf_whoami', 'pf_write', 'pf_delete', 'pf_set_name')), 'public RPCs retain security definer and empty search path');
insert into pf.owner_keys (project, owner_id, key_hash) values
  ('sprout', 'second', sha256(convert_to('example-second-owner-key', 'UTF8')));
select public.schema_check_assert(pf.owner_of('sprout', 'example-original-owner-key') = 'owner' and pf.owner_of('sprout', 'example-second-owner-key') = 'owner:second', 'helper distinguishes legacy and extra owners');
select public.schema_check_assert(pf.is_owner('sprout', 'example-second-owner-key') and not pf.is_owner('other-proto', 'example-second-owner-key'), 'is_owner preserves project scope');
select public.schema_check_error($q$insert into pf.owner_keys (project, owner_id, key_hash) values ('sprout', 'Invalid', sha256(convert_to('example-invalid-key', 'UTF8')))$q$, '23514', 'invalid owner id is rejected');
select public.schema_check_error($q$insert into pf.owner_keys (project, owner_id, key_hash) values ('sprout', 'dup', sha256(convert_to('example-second-owner-key', 'UTF8')))$q$, '23505', 'one key maps to one owner per project');
insert into pf.owner_keys (project, owner_id, key_hash) values ('sprout', 'legacy-alias', sha256(convert_to('example-original-owner-key', 'UTF8')));

set role anon;
select public.schema_check_assert(public.pf_whoami('sprout', null, 'example-original-owner-key') = '{"author":"owner","isOwner":true}'::jsonb, 'legacy key returns owner without reviewer secret');
select public.schema_check_assert(public.pf_whoami('sprout', null, 'example-original-owner-key')->>'author' = 'owner', 'legacy project key takes priority over matching extra owner row');
select public.schema_check_assert(public.pf_whoami('sprout', null, 'example-second-owner-key') = '{"author":"owner:second","isOwner":true}'::jsonb, 'extra key returns distinct owner');
select public.schema_check_assert(public.pf_whoami('other-proto', repeat('r', 32), 'example-second-owner-key')->>'isOwner' = 'false', 'extra key grants no rights in another project');
select public.schema_check_assert(public.pf_whoami('sprout', repeat('r', 32), 'example-other-project-key')->>'isOwner' = 'false', 'another project legacy key grants no rights');
reset role;
insert into pf.owner_keys (project, owner_id, key_hash) values ('other-proto', 'second', sha256(convert_to('example-second-owner-key', 'UTF8')));
set role anon;
select public.schema_check_assert(public.pf_whoami('other-proto', repeat('r', 32), 'example-second-owner-key') = '{"author":"owner:second","isOwner":true}'::jsonb, 'the same extra key can be provisioned in a second project');
reset role;
delete from pf.owner_keys where project = 'other-proto' and owner_id = 'second';
set role anon;
select public.schema_check_assert(public.pf_whoami('other-proto', repeat('r', 32), 'example-second-owner-key')->>'isOwner' = 'false', 'removing the second project row leaves no rights there');
select public.schema_check_assert(public.pf_whoami('sprout', repeat('r', 32))->>'author' ~ '^a_[0-9a-f]{20}$' and public.pf_whoami('sprout', repeat('r', 32))->>'isOwner' = 'false', 'reviewer identity remains unchanged');
select public.schema_check_assert(public.pf_list('sprout')->'names'->>'owner' = 'Original Owner', 'legacy name remains visible through API');
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Second Owner', 'example-second-owner-key')->>'author' = 'owner:second', 'extra owner sets its own name');
select public.schema_check_assert(public.pf_write('sprout', 'comments', 'second-comment', '{"text":"Second comment","status":"resolved","approved":true}', null, 'example-second-owner-key')->>'byOwner' = 'true', 'extra owner comments carry byOwner');
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Original Owner Updated', 'example-original-owner-key')->>'author' = 'owner', 'legacy owner changes only own name');
select public.schema_check_assert(public.pf_list('sprout')->'names' @> '{"owner":"Original Owner Updated","owner:second":"Second Owner"}'::jsonb, 'owner names remain independent');
select public.schema_check_assert(public.pf_write('sprout', 'comments', 'original-comment', '{"status":"resolved","approved":true}', null, 'example-original-owner-key', true)->'data' @> '{"status":"resolved","approved":true}'::jsonb, 'legacy owner writes guarded fields');
select public.schema_check_assert(public.pf_write('sprout', 'comments', 'original-comment', '{"status":"open","approved":false,"by":"claude"}', null, 'example-second-owner-key', true)->'data' @> '{"author":"owner","byOwner":true,"status":"open","approved":false,"by":"claude"}'::jsonb, 'extra owner writes guarded fields and preserves existing attribution');
select public.schema_check_assert(public.pf_write('sprout', 'comments', 'reviewer-comment', '{"text":"Reviewer comment","author":"owner:second","byOwner":true,"status":"resolved","approved":true,"by":"claude"}', repeat('r', 32))->'data' @> '{"status":"open","byOwner":false}'::jsonb, 'reviewer cannot spoof owner status');
select public.schema_check_assert((select d->>'author' ~ '^a_[0-9a-f]{20}$' and not (d->'data' ? 'approved') and not (d->'data' ? 'by') from jsonb_array_elements(public.pf_list('sprout')->'docs') d where d->>'id' = 'reviewer-comment'), 'reviewer author and guarded fields are server controlled');
select public.schema_check_assert(public.pf_write('sprout', 'comments', 'reviewer-comment', '{"text":"Updated reviewer comment","status":"resolved"}', repeat('r', 32), null, true)->'data'->>'status' = 'open', 'reviewer can edit own comment without changing guarded fields');
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'reviewer-comment', '{"text":"Foreign edit"}', repeat('s', 32))$q$, 'PT403', 'reviewer cannot edit another reviewer comment');
select public.schema_check_error($q$select public.pf_delete('sprout', 'comments', 'reviewer-comment', repeat('s', 32))$q$, 'PT403', 'reviewer cannot delete another reviewer comment');
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'original-comment', '{"status":"resolved"}', repeat('r', 32))$q$, 'PT403', 'reviewer cannot edit owner comment');
select public.schema_check_error($q$select public.pf_delete('sprout', 'comments', 'original-comment', repeat('r', 32))$q$, 'PT403', 'reviewer cannot delete owner comment');
select public.schema_check_error($q$select pf.owner_of('sprout', 'example-second-owner-key')$q$, '42501', 'anon cannot call private owner helper');
select public.pf_delete('sprout', 'comments', 'reviewer-comment', repeat('r', 32));
select public.schema_check_assert(not exists (select 1 from jsonb_array_elements(public.pf_list('sprout')->'docs') d where d->>'id' = 'reviewer-comment'), 'reviewer can delete own comment');
reset role;

delete from pf.owner_keys where project = 'sprout' and owner_id = 'second';
set role anon;
select public.schema_check_assert(public.pf_whoami('sprout', repeat('r', 32), 'example-second-owner-key')->>'isOwner' = 'false', 'revoked key no longer grants owner rights');
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'second-comment', '{"status":"open"}', repeat('r', 32), 'example-second-owner-key')$q$, 'PT403', 'revoked owner cannot edit its former comment');
select public.schema_check_assert(public.pf_list('sprout')->'names'->>'owner:second' = 'Second Owner', 'revocation preserves historical owner name');
reset role;
insert into pf.owner_keys (project, owner_id, key_hash) values ('sprout', 'second', sha256(convert_to('example-second-owner-key', 'UTF8')));

-- Owner per-minute buckets are independent, and remain separate from reviewer limits.
delete from pf.write_log;
insert into pf.write_log (project, author) select 'sprout', 'owner' from generate_series(1, 60);
set role anon;
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Second Owner', 'example-second-owner-key')->>'author' = 'owner:second', 'legacy owner limit does not block added owner');
select public.schema_check_error($q$select public.pf_set_name('sprout', null, 'Blocked Owner', 'example-original-owner-key')$q$, 'PT429', 'legacy owner still limited to sixty writes per minute');
reset role;
delete from pf.write_log;
insert into pf.write_log (project, author) select 'sprout', 'owner:second' from generate_series(1, 60);
set role anon;
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Original Owner Updated', 'example-original-owner-key')->>'author' = 'owner', 'added owner limit does not block legacy owner');
select public.schema_check_error($q$select public.pf_set_name('sprout', null, 'Blocked Owner', 'example-second-owner-key')$q$, 'PT429', 'added owner limited to sixty writes per minute');
reset role;
delete from pf.write_log;
select set_config('request.headers', '{"cf-connecting-ip":"192.0.2.10"}', false);
insert into pf.write_log (project, author, ip) select 'sprout', 'owner:second', '192.0.2.10' from generate_series(1, 60);
insert into pf.write_log (project, author, ip, at) select 'sprout', 'owner:second', '192.0.2.10', now() - interval '2 hours' from generate_series(1, 3000);
set role anon;
select public.schema_check_assert(public.pf_write('sprout', 'comments', 'rate-reviewer', '{"text":"Reviewer unaffected by owner traffic"}', repeat('r', 32))->>'byOwner' = 'false', 'added owner traffic excluded from reviewer IP and daily limits');
reset role;
delete from pf.write_log;
insert into pf.write_log (project, author, ip) select 'other-proto', pf.author_of(repeat('r', 32)), null from generate_series(1, 20);
set role anon;
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'limited-reviewer', '{"text":"Limit check"}', repeat('r', 32))$q$, 'PT429', 'reviewer author limit remains global and twenty per minute');
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Second Owner', 'example-second-owner-key')->>'author' = 'owner:second', 'reviewer author flood cannot lock out owner');
reset role;
delete from pf.write_log;
insert into pf.write_log (project, author, ip) select 'other-proto', 'a_' || repeat('0', 20), '192.0.2.10' from generate_series(1, 60);
set role anon;
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'limited-reviewer', '{"text":"Limit check"}', repeat('r', 32))$q$, 'PT429', 'reviewer IP limit remains sixty per minute');
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Second Owner', 'example-second-owner-key')->>'author' = 'owner:second', 'reviewer IP flood cannot lock out owner');
reset role;
delete from pf.write_log;
insert into pf.write_log (project, author, at) select 'sprout', 'a_' || repeat('0', 20), now() - interval '2 hours' from generate_series(1, 3000);
set role anon;
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'limited-reviewer', '{"text":"Limit check"}', repeat('r', 32))$q$, 'PT429', 'reviewer project daily limit remains three thousand');
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Second Owner', 'example-second-owner-key')->>'author' = 'owner:second', 'reviewer daily flood cannot lock out owner');
reset role;
delete from pf.write_log;

update pf.projects set max_docs = (select count(*) from pf.docs where project = 'sprout'), max_names = (select count(*) from pf.names where project = 'sprout') where slug = 'sprout';
set role anon;
select public.schema_check_error($q$select public.pf_write('sprout', 'comments', 'quota-comment', '{"text":"Quota check"}', null, 'example-second-owner-key')$q$, 'PT429', 'added owner still respects document quota');
select public.schema_check_error($q$select public.pf_set_name('sprout', repeat('t', 32), 'New Reviewer')$q$, 'PT429', 'new reviewer still respects name quota');
select public.schema_check_assert(public.pf_set_name('sprout', null, 'Second Owner', 'example-second-owner-key')->>'author' = 'owner:second', 'existing owner name can update at name quota');
select public.pf_delete('sprout', 'comments', 'original-comment', null, 'example-second-owner-key');
select public.schema_check_assert(not exists (select 1 from jsonb_array_elements(public.pf_list('sprout')->'docs') d where d->>'id' in ('original-comment', 'original-reply')), 'added owner can delete foreign comment and its replies');
reset role;
