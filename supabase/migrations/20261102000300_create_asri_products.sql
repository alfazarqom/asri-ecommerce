-- Public product-feed schema for Asri Collection.
-- Direct table access remains closed; the no-JWT Edge Function reads via service_role.

create table if not exists public.asri_products (
  id text primary key,
  title text not null,
  description text not null,
  availability text not null default 'in stock',
  condition text not null default 'new',
  price numeric(15,2) not null,
  link text not null,
  image_link text not null,
  brand text not null,
  gtin text,
  mpn text,
  item_group_id text,
  google_product_category text,
  fb_product_category text,
  product_type text,
  custom_label_0 text,
  custom_label_1 text,
  custom_label_2 text,
  custom_label_3 text,
  custom_label_4 text,
  sale_price numeric(15,2),
  sale_price_effective_date text,
  currency char(3) not null default 'IDR',
  additional_image_link text[],
  video text,
  color text,
  size text,
  size_type text,
  size_system text,
  gender text,
  age_group text,
  material text,
  pattern text,
  style text,
  model text,
  inventory integer,
  expiration_date timestamptz,
  shipping text,
  shipping_weight text,
  shipping_length text,
  shipping_width text,
  shipping_height text,
  additional_variant_attribute jsonb,
  rich_text_description text,
  status text,
  visibility text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint asri_products_availability_check
    check (availability in ('in stock', 'out of stock', 'preorder', 'available for order', 'discontinued')),
  constraint asri_products_condition_check
    check (condition in ('new', 'refurbished', 'used')),
  constraint asri_products_price_check
    check (price >= 0),
  constraint asri_products_sale_price_check
    check (sale_price is null or sale_price >= 0),
  constraint asri_products_inventory_check
    check (inventory is null or inventory >= 0)
);

alter table public.asri_products enable row level security;

-- The catalog is exposed only through get-asri-products, never through direct Data API table access.
revoke all on table public.asri_products from public, anon, authenticated;
grant select on table public.asri_products to service_role;
