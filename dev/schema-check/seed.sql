-- Seed exclusively fictional data. RPC calls run with the same role as PostgREST.
insert into pf.projects (slug, owner_key_hash) values
  ('sprout', sha256(convert_to('example-original-owner-key', 'UTF8'))),
  ('other-proto', sha256(convert_to('example-other-project-key', 'UTF8')));
set role anon;
select public.pf_set_name('sprout', null, 'Original Owner', 'example-original-owner-key');
select public.pf_write('sprout', 'comments', 'original-comment',
  '{"text":"Original comment","status":"open"}', null, 'example-original-owner-key');
select public.pf_write('sprout', 'replies', 'original-reply',
  '{"text":"Original reply","commentId":"original-comment"}', null, 'example-original-owner-key');
reset role;
