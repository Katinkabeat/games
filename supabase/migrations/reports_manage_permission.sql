-- ============================================================
-- HUB — Gate reports admin access on the manage_reports permission
--
-- Previously: any row in `admins` could read/update reports.
-- Now: must be master admin OR have 'manage_reports' in permissions.
--
-- Idempotent: safe to re-run.
-- ============================================================

drop policy if exists reports_select_admin on public.reports;
drop policy if exists reports_update_admin on public.reports;

create policy reports_select_admin
  on public.reports for select
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
        and (a.is_master or 'manage_reports' = any(a.permissions))
    )
  );

create policy reports_update_admin
  on public.reports for update
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
        and (a.is_master or 'manage_reports' = any(a.permissions))
    )
  );
