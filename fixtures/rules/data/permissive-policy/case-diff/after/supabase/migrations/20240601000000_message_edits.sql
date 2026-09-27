create policy "Anyone can edit messages" on public.messages for update using (true) with check (true); -- expect-block: data/permissive-policy

create policy "Senders can delete their messages" on public.messages for delete to authenticated using (sender = (select auth.uid())); -- ok: checks the sender
