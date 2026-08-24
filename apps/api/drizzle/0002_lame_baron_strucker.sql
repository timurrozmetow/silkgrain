ALTER TABLE `promo_codes` ADD CONSTRAINT `promo_codes_percent_range` CHECK (`promo_codes`.`type` <> 'percent' OR `promo_codes`.`value` BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE `promo_codes` ADD CONSTRAINT `promo_codes_fixed_range` CHECK (`promo_codes`.`type` <> 'fixed' OR `promo_codes`.`value` BETWEEN 1 AND 2147483647);--> statement-breakpoint
ALTER TABLE `promo_codes` ADD CONSTRAINT `promo_codes_limits_positive` CHECK ((`promo_codes`.`usage_limit` IS NULL OR `promo_codes`.`usage_limit` > 0)
        AND (`promo_codes`.`usage_limit_per_customer` IS NULL OR `promo_codes`.`usage_limit_per_customer` > 0));--> statement-breakpoint
ALTER TABLE `promo_codes` ADD CONSTRAINT `promo_codes_cap_percent_only` CHECK (`promo_codes`.`type` = 'percent' OR `promo_codes`.`max_discount_cents` IS NULL);--> statement-breakpoint
CREATE INDEX `orders_promo_code_idx` ON `orders` (`promo_code`);