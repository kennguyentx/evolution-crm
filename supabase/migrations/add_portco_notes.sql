-- Allow notes to be linked directly to a portfolio company
-- (not just through a deal). Used for industry notes, portco updates,
-- and forwarded emails filed under a portfolio company.

alter table notes
  add column if not exists portfolio_company_id uuid references portfolio_companies(id) on delete set null;

create index if not exists notes_portfolio_company_id_idx on notes(portfolio_company_id);
