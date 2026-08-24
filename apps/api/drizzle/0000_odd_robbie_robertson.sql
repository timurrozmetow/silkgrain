CREATE TABLE `categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(160) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`icon` varchar(60),
	`image_url` varchar(500),
	`parent_id` bigint unsigned,
	`position` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`meta_title` varchar(200),
	`meta_description` varchar(320),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`variant_id` bigint unsigned NOT NULL,
	`delta` int NOT NULL,
	`reason` enum('order','restock','adjustment','return','cancellation') NOT NULL,
	`reference_id` bigint unsigned,
	`note` varchar(300),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_badges` (
	`product_id` bigint unsigned NOT NULL,
	`badge` enum('bestseller','new','premium') NOT NULL,
	CONSTRAINT `product_badges_product_id_badge_pk` PRIMARY KEY(`product_id`,`badge`)
);
--> statement-breakpoint
CREATE TABLE `product_certifications` (
	`product_id` bigint unsigned NOT NULL,
	`certification` enum('organic','non_gmo','halal','kosher','gluten_free') NOT NULL,
	CONSTRAINT `product_certifications_product_id_certification_pk` PRIMARY KEY(`product_id`,`certification`)
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`url` varchar(500) NOT NULL,
	`alt` varchar(300) NOT NULL,
	`width` int,
	`height` int,
	`position` int NOT NULL DEFAULT 0,
	`is_primary` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `product_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_nutrition` (
	`product_id` bigint unsigned NOT NULL,
	`serving_size` varchar(60) NOT NULL,
	`servings_per_container` int,
	`calories` int NOT NULL,
	`fat_mg` int NOT NULL,
	`sat_fat_mg` int NOT NULL,
	`carbs_mg` int NOT NULL,
	`sugars_mg` int NOT NULL,
	`fiber_mg` int NOT NULL,
	`protein_mg` int NOT NULL,
	`sodium_mg` int NOT NULL,
	`ingredients_text` text NOT NULL,
	`allergens_text` varchar(400),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `product_nutrition_product_id` PRIMARY KEY(`product_id`)
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`sku` varchar(64) NOT NULL,
	`weight_value_milli` int NOT NULL,
	`weight_unit` enum('lb','oz','g','kit') NOT NULL,
	`weight_label` varchar(40) NOT NULL,
	`weight_grams` int,
	`price_cents` bigint NOT NULL,
	`compare_at_price_cents` bigint,
	`cost_cents` bigint,
	`stock_qty` int NOT NULL DEFAULT 0,
	`low_stock_threshold` int NOT NULL DEFAULT 10,
	`position` int NOT NULL DEFAULT 0,
	`is_default` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `product_variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_variants_sku_uq` UNIQUE(`sku`),
	CONSTRAINT `product_variants_stock_nonneg` CHECK(`product_variants`.`stock_qty` >= 0),
	CONSTRAINT `product_variants_price_nonneg` CHECK(`product_variants`.`price_cents` >= 0),
	CONSTRAINT `product_variants_compare_at_higher` CHECK(`product_variants`.`compare_at_price_cents` IS NULL OR `product_variants`.`compare_at_price_cents` > `product_variants`.`price_cents`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(160) NOT NULL,
	`name` varchar(200) NOT NULL,
	`subtitle` varchar(200),
	`blurb` varchar(300) NOT NULL,
	`description` text NOT NULL,
	`story` text,
	`category_id` bigint unsigned NOT NULL,
	`origin` enum('UZ','KZ','TM','KG','TJ','MIXED') NOT NULL,
	`origin_region` varchar(160),
	`status` enum('draft','active','archived') NOT NULL DEFAULT 'draft',
	`is_featured` boolean NOT NULL DEFAULT false,
	`tone` varchar(200),
	`icon` varchar(60),
	`rating_total` int NOT NULL DEFAULT 0,
	`review_count` int NOT NULL DEFAULT 0,
	`sold_count` int NOT NULL DEFAULT 0,
	`meta_title` varchar(200),
	`meta_description` varchar(320),
	`published_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `products_rating_total_nonneg` CHECK(`products`.`rating_total` >= 0),
	CONSTRAINT `products_review_count_nonneg` CHECK(`products`.`review_count` >= 0)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned,
	`author_name` varchar(120) NOT NULL,
	`rating` tinyint NOT NULL,
	`title` varchar(160),
	`body` text NOT NULL,
	`status` enum('pending','published','rejected') NOT NULL DEFAULT 'pending',
	`is_verified_purchase` boolean NOT NULL DEFAULT false,
	`published_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviews_rating_range` CHECK(`reviews`.`rating` BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(254) NOT NULL,
	`subject` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`order_number` varchar(20),
	`status` enum('new','read','answered','spam') NOT NULL DEFAULT 'new',
	`submitted_ip` varchar(45),
	`answered_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `contact_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `faqs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`category` enum('ordering','shipping','products','wholesale','returns') NOT NULL,
	`question` varchar(300) NOT NULL,
	`answer` text NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`is_published` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `faqs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`status` enum('subscribed','unsubscribed','bounced') NOT NULL DEFAULT 'subscribed',
	`source` varchar(40),
	`unsubscribe_token` varchar(64) NOT NULL,
	`confirmed_at` datetime(3),
	`unsubscribed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `newsletter_subscribers_id` PRIMARY KEY(`id`),
	CONSTRAINT `newsletter_subscribers_email_uq` UNIQUE(`email`),
	CONSTRAINT `newsletter_subscribers_token_uq` UNIQUE(`unsubscribe_token`)
);
--> statement-breakpoint
CREATE TABLE `recipe_products` (
	`recipe_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `recipe_products_recipe_id_product_id_pk` PRIMARY KEY(`recipe_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(160) NOT NULL,
	`title` varchar(200) NOT NULL,
	`excerpt` varchar(400) NOT NULL,
	`hero_image_url` varchar(500),
	`hero_image_alt` varchar(300),
	`body` text NOT NULL,
	`prep_minutes` int NOT NULL,
	`cook_minutes` int NOT NULL,
	`servings` int NOT NULL,
	`difficulty` enum('easy','medium','hard') NOT NULL DEFAULT 'medium',
	`is_published` boolean NOT NULL DEFAULT false,
	`published_at` datetime(3),
	`meta_title` varchar(200),
	`meta_description` varchar(320),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `recipes_id` PRIMARY KEY(`id`),
	CONSTRAINT `recipes_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `recipes_times_nonneg` CHECK(`recipes`.`prep_minutes` >= 0 AND `recipes`.`cook_minutes` >= 0),
	CONSTRAINT `recipes_servings_positive` CHECK(`recipes`.`servings` > 0)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(120) NOT NULL,
	`role` enum('owner','manager','support') NOT NULL DEFAULT 'support',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255),
	`first_name` varchar(80) NOT NULL,
	`last_name` varchar(80) NOT NULL,
	`phone` varchar(32),
	`email_verified_at` datetime(3),
	`marketing_opt_in` boolean NOT NULL DEFAULT false,
	`status` enum('active','blocked') NOT NULL DEFAULT 'active',
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`subject_type` enum('customer','admin') NOT NULL,
	`subject_id` bigint unsigned NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`family_id` varchar(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`revoked_reason` varchar(40),
	`user_agent` varchar(400),
	`ip` varchar(45),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`wishlist_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`variant_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wishlist_items_wishlist_id_product_id_pk` PRIMARY KEY(`wishlist_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `wishlists` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL DEFAULT 'Wishlist',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wishlists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `addresses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`type` enum('shipping','billing') NOT NULL,
	`first_name` varchar(80) NOT NULL,
	`last_name` varchar(80) NOT NULL,
	`line1` varchar(200) NOT NULL,
	`line2` varchar(200),
	`city` varchar(100) NOT NULL,
	`state` varchar(2) NOT NULL,
	`zip` varchar(10) NOT NULL,
	`country` varchar(2) NOT NULL DEFAULT 'US',
	`phone` varchar(32),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `addresses_id` PRIMARY KEY(`id`),
	CONSTRAINT `addresses_order_type_uq` UNIQUE(`order_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned,
	`variant_id` bigint unsigned,
	`product_slug` varchar(160) NOT NULL,
	`name` varchar(200) NOT NULL,
	`sku` varchar(64) NOT NULL,
	`weight_label` varchar(40) NOT NULL,
	`image_url` varchar(500),
	`unit_price_cents` bigint NOT NULL,
	`qty` int NOT NULL,
	`line_total_cents` bigint NOT NULL,
	`line_discount_cents` bigint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_items_qty_positive` CHECK(`order_items`.`qty` > 0),
	CONSTRAINT `order_items_price_nonneg` CHECK(`order_items`.`unit_price_cents` >= 0)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_number` varchar(20) NOT NULL,
	`email` varchar(254) NOT NULL,
	`customer_id` bigint unsigned,
	`status` enum('pending','paid','processing','shipped','delivered','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`subtotal_cents` bigint NOT NULL,
	`discount_cents` bigint NOT NULL DEFAULT 0,
	`shipping_cents` bigint NOT NULL DEFAULT 0,
	`tax_cents` bigint NOT NULL DEFAULT 0,
	`total_cents` bigint NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`promo_code` varchar(32),
	`promo_discount_cents` bigint NOT NULL DEFAULT 0,
	`shipping_method` enum('standard','express','overnight') NOT NULL,
	`carrier` varchar(60),
	`tracking_number` varchar(120),
	`tracking_url` varchar(500),
	`customer_note` text,
	`admin_note` text,
	`paid_at` datetime(3),
	`shipped_at` datetime(3),
	`delivered_at` datetime(3),
	`cancelled_at` datetime(3),
	`refunded_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_number_uq` UNIQUE(`order_number`),
	CONSTRAINT `orders_totals_nonneg` CHECK(`orders`.`subtotal_cents` >= 0 AND `orders`.`total_cents` >= 0)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`provider` enum('stripe','paypal') NOT NULL,
	`provider_payment_id` varchar(190) NOT NULL,
	`status` enum('requires_payment','processing','succeeded','failed','cancelled','refunded','partially_refunded') NOT NULL DEFAULT 'requires_payment',
	`amount_cents` bigint NOT NULL,
	`refunded_cents` bigint NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`card_brand` varchar(40),
	`card_last4` varchar(4),
	`failure_code` varchar(80),
	`failure_message` varchar(400),
	`raw_payload` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_provider_payment_uq` UNIQUE(`provider`,`provider_payment_id`),
	CONSTRAINT `payments_refund_within_amount` CHECK(`payments`.`refunded_cents` <= `payments`.`amount_cents`)
);
--> statement-breakpoint
CREATE TABLE `promo_codes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`description` varchar(200),
	`type` enum('percent','fixed','free_shipping') NOT NULL,
	`value` int NOT NULL,
	`min_order_cents` bigint NOT NULL DEFAULT 0,
	`max_discount_cents` bigint,
	`usage_limit` int,
	`usage_limit_per_customer` int,
	`used_count` int NOT NULL DEFAULT 0,
	`starts_at` datetime(3),
	`ends_at` datetime(3),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `promo_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `promo_codes_code_uq` UNIQUE(`code`),
	CONSTRAINT `promo_codes_value_nonneg` CHECK(`promo_codes`.`value` >= 0),
	CONSTRAINT `promo_codes_used_nonneg` CHECK(`promo_codes`.`used_count` >= 0),
	CONSTRAINT `promo_codes_window_ordered` CHECK(`promo_codes`.`ends_at` IS NULL OR `promo_codes`.`starts_at` IS NULL OR `promo_codes`.`ends_at` > `promo_codes`.`starts_at`)
);
--> statement-breakpoint
CREATE TABLE `promo_redemptions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`promo_code_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned,
	`email` varchar(254) NOT NULL,
	`discount_cents` bigint NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `promo_redemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `promo_redemptions_order_uq` UNIQUE(`order_id`,`promo_code_id`)
);
--> statement-breakpoint
CREATE TABLE `shipping_rates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` enum('standard','express','overnight') NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` varchar(200),
	`price_cents` bigint NOT NULL,
	`free_above_cents` bigint,
	`estimated_days_min` int NOT NULL,
	`estimated_days_max` int NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`position` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `shipping_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipping_rates_code_uq` UNIQUE(`code`),
	CONSTRAINT `shipping_rates_price_nonneg` CHECK(`shipping_rates`.`price_cents` >= 0),
	CONSTRAINT `shipping_rates_days_ordered` CHECK(`shipping_rates`.`estimated_days_max` >= `shipping_rates`.`estimated_days_min`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`provider` enum('stripe','paypal') NOT NULL,
	`event_id` varchar(190) NOT NULL,
	`event_type` varchar(120) NOT NULL,
	`payload` json,
	`processed_at` datetime(3),
	`error` text,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_event_id_uq` UNIQUE(`provider`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`admin_user_id` bigint unsigned,
	`actor_name` varchar(120) NOT NULL,
	`action` varchar(60) NOT NULL,
	`entity_type` varchar(60) NOT NULL,
	`entity_id` bigint unsigned,
	`before` json,
	`after` json,
	`ip` varchar(45),
	`user_agent` varchar(400),
	`note` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`value` json,
	`group_name` varchar(60) NOT NULL DEFAULT 'general',
	`label` varchar(200) NOT NULL,
	`description` varchar(400),
	`is_public` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_key_uq` UNIQUE(`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `wholesale_price_tiers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`variant_id` bigint unsigned NOT NULL,
	`min_qty` int NOT NULL,
	`price_cents` bigint NOT NULL,
	`valid_from` datetime(3),
	`valid_to` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wholesale_price_tiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `wholesale_price_tiers_variant_qty_uq` UNIQUE(`variant_id`,`min_qty`),
	CONSTRAINT `wholesale_price_tiers_min_qty_positive` CHECK(`wholesale_price_tiers`.`min_qty` > 0),
	CONSTRAINT `wholesale_price_tiers_price_nonneg` CHECK(`wholesale_price_tiers`.`price_cents` >= 0)
);
--> statement-breakpoint
CREATE TABLE `wholesale_request_notes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`request_id` bigint unsigned NOT NULL,
	`admin_user_id` bigint unsigned,
	`author_name` varchar(120) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wholesale_request_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wholesale_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`business_name` varchar(200) NOT NULL,
	`business_type` enum('restaurant','grocery','distributor','meal_kit','other') NOT NULL,
	`contact_first_name` varchar(80) NOT NULL,
	`contact_last_name` varchar(80),
	`email` varchar(254) NOT NULL,
	`phone` varchar(32),
	`address_line1` varchar(200),
	`address_line2` varchar(200),
	`city` varchar(100),
	`state` varchar(2),
	`zip` varchar(10),
	`categories_of_interest` json,
	`monthly_volume_band` enum('50-200','200-500','500-2000','2000+') NOT NULL,
	`notes` text,
	`status` enum('new','contacted','quoted','converted','declined') NOT NULL DEFAULT 'new',
	`assigned_to_id` bigint unsigned,
	`submitted_ip` varchar(45),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wholesale_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_variant_id_product_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_badges` ADD CONSTRAINT `product_badges_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_certifications` ADD CONSTRAINT `product_certifications_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_nutrition` ADD CONSTRAINT `product_nutrition_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_products` ADD CONSTRAINT `recipe_products_recipe_id_recipes_id_fk` FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_products` ADD CONSTRAINT `recipe_products_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_wishlist_id_wishlists_id_fk` FOREIGN KEY (`wishlist_id`) REFERENCES `wishlists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wishlist_items` ADD CONSTRAINT `wishlist_items_variant_id_product_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wishlists` ADD CONSTRAINT `wishlists_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_variant_id_product_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_redemptions` ADD CONSTRAINT `promo_redemptions_promo_code_id_promo_codes_id_fk` FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_redemptions` ADD CONSTRAINT `promo_redemptions_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `promo_redemptions` ADD CONSTRAINT `promo_redemptions_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wholesale_price_tiers` ADD CONSTRAINT `wholesale_price_tiers_variant_id_product_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wholesale_request_notes` ADD CONSTRAINT `wholesale_request_notes_request_id_wholesale_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `wholesale_requests`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wholesale_request_notes` ADD CONSTRAINT `wholesale_request_notes_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wholesale_requests` ADD CONSTRAINT `wholesale_requests_assigned_to_id_admin_users_id_fk` FOREIGN KEY (`assigned_to_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `inventory_movements_variant_idx` ON `inventory_movements` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`,`position`);--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_variants_price_idx` ON `product_variants` (`price_cents`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`,`is_featured`);--> statement-breakpoint
CREATE INDEX `products_origin_idx` ON `products` (`origin`);--> statement-breakpoint
CREATE INDEX `reviews_product_idx` ON `reviews` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `contact_messages_status_idx` ON `contact_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `faqs_category_idx` ON `faqs` (`category`,`position`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_subject_idx` ON `refresh_tokens` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_expiry_idx` ON `refresh_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `wishlists_customer_idx` ON `wishlists` (`customer_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_variant_idx` ON `order_items` (`variant_id`);--> statement-breakpoint
CREATE INDEX `orders_email_idx` ON `orders` (`email`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `promo_redemptions_email_idx` ON `promo_redemptions` (`promo_code_id`,`email`);--> statement-breakpoint
CREATE INDEX `webhook_events_processed_idx` ON `webhook_events` (`processed_at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wholesale_request_notes_request_idx` ON `wholesale_request_notes` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wholesale_requests_status_idx` ON `wholesale_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `wholesale_requests_email_idx` ON `wholesale_requests` (`email`);