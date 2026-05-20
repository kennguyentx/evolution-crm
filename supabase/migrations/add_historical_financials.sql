-- Add structured historical financials and additional CIM fields to deals
-- historical_financials: [{year, revenue, ebitda, margin}] array from CIM extraction
-- customer_concentration: free-text description of customer mix
-- employee_count: headcount at time of CIM

alter table deals
  add column if not exists historical_financials jsonb,
  add column if not exists customer_concentration text,
  add column if not exists employee_count integer;
