-- Rename the legacy catalog table without recreating it or losing existing rows.
-- The original create_asri_products migration is already applied and remains immutable.

alter table public.asri_products rename to products;

alter table public.products
  rename constraint asri_products_availability_check to products_availability_check;

alter table public.products
  rename constraint asri_products_condition_check to products_condition_check;

alter table public.products
  rename constraint asri_products_price_check to products_price_check;

alter table public.products
  rename constraint asri_products_sale_price_check to products_sale_price_check;

alter table public.products
  rename constraint asri_products_inventory_check to products_inventory_check;
