-- Executar no SQL Editor do Supabase (bucket público para URLs em e-mails fiscais).
insert into storage.buckets (id, name, public)
values ('invoices-fiscal', 'invoices-fiscal', true)
on conflict (id) do nothing;

drop policy if exists "invoices_fiscal_public_read" on storage.objects;
create policy "invoices_fiscal_public_read"
on storage.objects for select
to public
using (bucket_id = 'invoices-fiscal');

-- Escrita: apenas service role (backend) — sem policy INSERT para anon/authenticated.
