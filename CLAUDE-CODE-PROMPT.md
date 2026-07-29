# SilkGrain — промпт для Claude Code

> Скопируй всё содержимое ниже в Claude Code как первое сообщение.
> Перед этим положи распакованный `Silkgrain_design_prompt-handoff.zip` в корень будущего репозитория.

---

## 0. Роль и правила игры

Ты — ведущий инженер проекта **SilkGrain**: e-commerce платформа для импорта и продажи центральноазиатских продуктов (рис, чечевица, крупы, сухофрукты, специи) в США. Юрлицо — LLC в Хьюстоне, Техас. Валюта USD, язык интерфейса — английский.

Работаем строго по фазам. **Правило: не переходишь к следующей фазе, пока текущая не проходит свои acceptance-критерии локально.** В конце каждой фазы останавливаешься, показываешь мне результат проверок и ждёшь подтверждения.

Если что-то в дизайне или требованиях неоднозначно — спрашивай, не додумывай. Лучше один вопрос сейчас, чем переписывать модуль потом.

Никаких заглушек вида `// TODO: implement later` в коде, который считается готовым. Если функция не влезает в текущую фазу — она не создаётся вообще, а записывается в `BACKLOG.md`.

---

## 1. Источник истины по дизайну

В корне лежит папка `silkgrain-design-prompt/`. Это handoff-бандл из Claude Design.

**Первое, что ты делаешь:**

1. Прочитай `silkgrain-design-prompt/README.md`.
2. Прочитай **полностью**, не по диагонали: `silkgrain-design-prompt/project/SilkGrain Premium.dc.html` — это главный макет (222 KB, все 16 экранов в одном файле, переключаются через `sc-if`).
3. Прочитай вспомогательные: `SilkGrain Storefront.dc.html`, `SilkGrain v2.dc.html`, `SilkGrain Directions.dc.html`, `SilkGrain Palettes.dc.html`, три варианта `ProductCard*.dc.html`.
4. Логотип: `silkgrain-design-prompt/project/assets/silkgrain-logo.jpeg`.

**Важно про формат макетов.** Это НЕ production-код. Синтаксис `<x-dc>`, `<sc-if>`, `<sc-for>`, `{{ binding }}`, `style-hover=` — это DSL дизайн-инструмента. Твоя задача — воспроизвести **визуальный результат** пиксель-в-пиксель на React, а не копировать структуру прототипа. Инлайн-стили из макета переводи в дизайн-токены и Tailwind-классы.

Не рендери эти файлы в браузере и не делай скриншоты — все размеры, цвета и правила лежат в исходнике текстом.

### Экраны, которые есть в макете

Флаги `sc-if` в `SilkGrain Premium.dc.html` задают роутинг прототипа:

| Флаг          | Экран                | Роут в проде                 |
| ------------- | -------------------- | ---------------------------- |
| `isHome`      | Главная              | `/`                          |
| `isShop`      | Каталог + фильтры    | `/shop`                      |
| `isCategory`  | Категория            | `/shop/c/:slug`              |
| `isProduct`   | Карточка товара      | `/product/:slug`             |
| `isCart`      | Корзина              | `/cart`                      |
| `isCheckout`  | Оформление           | `/checkout`                  |
| `isConfirm`   | Подтверждение заказа | `/order/:number`             |
| `isTrack`     | Отслеживание         | `/track`                     |
| `isWholesale` | Оптовая заявка       | `/wholesale`                 |
| `isAbout`     | О компании           | `/about`                     |
| `isRecipes`   | Рецепты              | `/recipes`, `/recipes/:slug` |
| `isFaq`       | FAQ + контакты       | `/help`                      |
| `isAccount`   | Личный кабинет       | `/account/*`                 |
| `isWishlist`  | Избранное            | `/wishlist`                  |
| `isAdmin`     | Админ-панель         | `/admin/*`                   |
| `isStates`    | 404 и empty states   | системные                    |

Плюс глобальные оверлеи из макета: mega-menu под пунктом Shop, поисковый оверлей (`searchOpen` + `searchSug`), cart drawer (`openDrawer`), quick-view модалка (`openQuickView`), announcement bar сверху.

### Дизайн-токены (извлечены из макета — используй ровно эти значения)

```ts
// packages/ui/tokens.ts
export const color = {
  green: '#0E6B4A', // primary, CTA, логотип «silk»
  greenHover: '#10815A', // hover primary
  greenDeep: '#0B3D2C', // announcement bar, admin sidebar
  greenMuted: '#4C7A5A',
  sage: '#64806F',
  sageLight: '#9DAE97',
  sageBg: '#E7F0E9',

  gold: '#D3A73B', // accent, badge, логотип «grain»
  goldDark: '#8F6A14', // eyebrow-текст, лейблы
  goldSoft: '#E9C877',
  goldPale: '#F1E9DA',

  parchment: '#F3F0E8', // основной фон страницы
  surface: '#FCFAF4', // фон карточек
  surfaceWarm: '#FBF6EC', // светлые кнопки на тёмном
  surfaceAlt: '#E9E5D7',

  ink: '#23231E', // заголовки
  inkSoft: '#1E1E1E',
  body: '#3A352B', // основной текст
  bodyMuted: '#4A4334',
  muted: '#6B6456', // вторичный текст
  mutedWarm: '#8A7F68',
  mutedPale: '#9A8F78',

  border: '#D9D0C0',
  borderSoft: '#E4E0D1',
  borderWarm: '#E4DAC6',

  terracotta: '#B85C38', // error, sale-бейдж, wishlist hover
  adminBg: '#EEF1EC',
  adminBorder: '#E2E5DF',
} as const;

export const font = {
  display: "'Cormorant Garamond', serif", // 500/600/700 — хиро, названия товаров
  serif: "'DM Serif Display', serif", // заголовки секций, admin headings
  body: "'Inter', sans-serif", // 400/500/600/700 — весь UI
  mono: "'DM Mono', monospace", // 400/500 — цены, eyebrow, счётчики, SKU
} as const;

export const radius = { sm: '4px', md: '6px', lg: '8px', xl: '18px', pill: '999px' } as const;

export const shadow = {
  card: '0 2px 12px rgba(46,93,58,0.08)',
  cardHover: '0 6px 24px rgba(46,93,58,0.14)',
  hero: '0 20px 50px rgba(14,58,42,0.15)',
  mega: '0 30px 60px rgba(11,46,33,0.12)',
} as const;

export const layout = {
  container: '1280px',
  gutter: '28px',
  headerH: '74px',
  adminAside: '248px',
} as const;
```

Ключевые правила типографики из макета:

- Eyebrow-лейблы: DM Mono, 11–12px, `letter-spacing: 0.18–0.22em`, uppercase, цвет `goldDark`.
- Цены и любые числа: DM Mono.
- Названия товаров и хиро-заголовки: Cormorant Garamond 600.
- Ромбовидный маркер `◆` (квадрат 6×6 повёрнутый на 45°, золотой) — фирменный разделитель, встречается в eyebrow и announcement bar. Вынеси в компонент `<Diamond />`.
- Иконки: `@phosphor-icons/react`, вариант `regular` по умолчанию, `fill` для логотипа и активных состояний.

Анимации из макета (перенеси в Tailwind keyframes): `sgUp` (fade-up 20px), `sgFloat` / `sgFloatB` (ambient float ±10px/8px), `sgGrow` (scaleX прогресс-бар), `sgPop` (появление бейджа), `sgShimmer` (skeleton). Все обёрнуты в `prefers-reduced-motion: reduce`.

---

## 2. Технический стек

Фиксирован, не меняй без обсуждения.

**Монорепо:** pnpm workspaces + Turborepo.

```
silkgrain/
├── apps/
│   ├── web/          React 18 + Vite 5 + TS + Tailwind + TanStack Router + TanStack Query + Zustand
│   ├── admin/        та же связка, отдельный билд, свой роут /admin
│   └── api/          Fastify 4 + TypeScript + Drizzle ORM + MySQL 8 + Redis + BullMQ + Zod
├── packages/
│   ├── ui/           общие компоненты, токены, Tailwind preset
│   ├── contracts/    Zod-схемы + типы, единый источник истины между api и web
│   └── config/       eslint, tsconfig, prettier
├── docker/           docker-compose.dev.yml (mysql, redis, mailpit, minio)
├── silkgrain-design-prompt/   макеты (read-only, в .gitignore не добавлять)
├── CLAUDE.md
├── BACKLOG.md
└── turbo.json
```

**Обязательные решения:**

- **Деньги — только целые центы в `BIGINT`.** Никаких `float`/`decimal` в бизнес-логике. Сделай value object `Money` в `packages/contracts` с методами `add`, `subtract`, `multiply(qty)`, `allocate`, `format(locale)`. Все суммы в API — целые числа + отдельное поле `currency: 'USD'`.
- **Валидация** — Zod-схемы в `packages/contracts`, используются и на бэке (`fastify-type-provider-zod`), и на фронте (react-hook-form + zodResolver). Одна схема, два потребителя.
- **Пароли** — Argon2id (`argon2` npm), никогда bcrypt.
- **Сессии** — JWT access (15 мин, в памяти) + refresh (30 дней, httpOnly Secure SameSite=Lax cookie, ротация при использовании). Refresh-токены в MySQL с возможностью отзыва.
- **Фоновые задачи** — BullMQ поверх Redis: письма, вебхуки, генерация отчётов, синк складских остатков.
- **Логи** — pino, structured JSON, `requestId` через `fastify-request-context`.
- **Ошибки** — единый формат `{ error: { code, message, details? } }`, коды в enum в `contracts`.
- **Rate limiting** — `@fastify/rate-limit` глобально + жёстче на `/auth/*`, `/wholesale`, `/checkout/*`.

---

## 3. Модель данных

Спроектируй схему в Drizzle. Ниже — обязательный минимум, ты дополняешь.

**Каталог**

- `categories` — id, slug, name, parent_id (self-ref для подкатегорий), icon (phosphor-имя), sort_order, is_active
- `products` — id, slug, name, subtitle, description (markdown), story (текст про происхождение), origin_country (UZ/TM/KZ/KG/TJ), category_id, is_active, is_featured, meta_title, meta_description, created_at
- `product_variants` — id, product_id, sku, weight_value, weight_unit (`lb`/`oz`), price_cents, compare_at_price_cents (для sale), stock_qty, low_stock_threshold, is_default
- `product_images` — id, product_id, url, alt, sort_order, is_primary
- `product_nutrition` — product_id, serving_size, calories, fat_g, carbs_g, protein_g, fiber_g, sodium_mg, ingredients_text, allergens_text
- `product_certifications` — product_id, cert (`organic` / `non_gmo` / `halal` / `kosher`)

**Заказы**

- `orders` — id, order_number (`SG-` + 8 цифр, уникальный), email, customer_id (nullable — гостевой заказ), status (`pending` / `paid` / `processing` / `shipped` / `delivered` / `cancelled` / `refunded`), subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, currency, promo_code, shipping_method, tracking_number, carrier, notes, created_at, paid_at, shipped_at
- `order_items` — id, order_id, product_id, variant_id, **снимок** name/sku/weight_label/unit_price_cents/qty/line_total_cents (снимок обязателен — цены меняются, история заказа не должна плыть)
- `addresses` — id, order_id, type (`shipping`/`billing`), first_name, last_name, line1, line2, city, state, zip, country, phone
- `payments` — id, order_id, provider (`stripe`/`paypal`), provider_payment_id, status, amount_cents, raw_payload (JSON), created_at
- `webhook_events` — id, provider, event_id (UNIQUE — идемпотентность), payload, processed_at, error

**Опт**

- `wholesale_requests` — id, business_name, business_type (`restaurant`/`grocery`/`distributor`/`meal_kit`/`other`), contact_first_name, contact_last_name, email, phone, address-поля, categories_of_interest (JSON), monthly_volume_band, notes, status (`new`/`contacted`/`quoted`/`converted`/`declined`), assigned_to, created_at
- `wholesale_request_notes` — id, request_id, admin_id, body, created_at
- `wholesale_price_tiers` — variant_id, min_qty, price_cents (задел на оптовый прайс)

**Пользователи**

- `customers` — id, email (UNIQUE), password_hash (nullable — гость может позже завести аккаунт), first_name, last_name, phone, email_verified_at, marketing_opt_in, created_at
- `admin_users` — id, email, password_hash, name, role (`owner`/`manager`/`support`), is_active, last_login_at
- `refresh_tokens` — id, subject_type, subject_id, token_hash, expires_at, revoked_at, user_agent, ip

**Прочее**

- `promo_codes` — code, type (`percent`/`fixed`/`free_shipping`), value, min_order_cents, usage_limit, used_count, starts_at, ends_at, is_active
- `wishlists` / `wishlist_items`
- `recipes` — slug, title, hero_image, body (markdown), prep_min, cook_min, servings, related_product_ids (JSON)
- `inventory_movements` — variant_id, delta, reason (`order`/`restock`/`adjustment`/`return`), reference_id, created_at
- `newsletter_subscribers`

Индексы: `products.slug`, `orders.order_number`, `orders.email`, `order_items.order_id`, `product_variants.product_id`, `webhook_events.event_id`.

Миграции — только через `drizzle-kit generate`, никаких ручных ALTER. Каждая миграция коммитится вместе с кодом, который её требует.

---

## 4. Платежи

**Stripe — основной шлюз.**

- Payment Element. Apple Pay и Google Pay включаются автоматически как payment methods внутри Payment Element — отдельно их интегрировать не надо, но нужно:
  - Apple Pay: положить файл верификации домена по пути `/.well-known/apple-developer-merchantid-domain-association` (Nginx отдаёт статикой), зарегистрировать домен в Stripe Dashboard.
  - Google Pay: работает из коробки на HTTPS.
- Флоу: `POST /api/checkout/intent` → создаём заказ в статусе `pending` + PaymentIntent с `metadata.order_id` → фронт подтверждает → **источник истины о статусе — webhook**, а не редирект. Редирект на `/order/:number` только показывает результат.
- Вебхуки: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`. Проверка подписи обязательна. В Fastify нужен **raw body** для этого роута — настрой `addContentTypeParser` только на `/api/webhooks/stripe`.
- Идемпотентность: перед обработкой пиши `event_id` в `webhook_events` с UNIQUE-констрейнтом; дубликат → сразу 200.

**PayPal — отдельная интеграция.** Не через Stripe (у Stripe PayPal ограничен по регионам для US-мерчантов). Используй PayPal JS SDK на фронте + Orders v2 API на бэке: `create order` → `capture` → сверка суммы на сервере перед подтверждением. Вебхук `PAYMENT.CAPTURE.COMPLETED`.

**Налог.** Sales tax в США зависит от nexus. На старте — **Stripe Tax** (`automatic_tax: { enabled: true }`), это закрывает расчёт корректно. Не пиши свой калькулятор налогов. В UI до ввода адреса показывай «Calculated at checkout».

**Доставка.** MVP: flat rates (Standard $0 при заказе от $75, иначе $6.99 / Express $12.99 / Overnight $24.99), хранить правила в БД, а не в коде. Интеграцию с Shippo/EasyPost — в `BACKLOG.md`.

**Склад.** Списание остатка — только в обработчике вебхука об успешной оплате, в одной транзакции с переводом заказа в `paid`. При создании PaymentIntent — мягкая проверка наличия, не резервирование (для MVP этого достаточно, гонки маловероятны при текущих объёмах). Отрицательный остаток запрещён на уровне БД (CHECK или явная проверка в транзакции).

---

## 5. Ключевые продуктовые требования

- **Гостевой чекаут — дефолт.** Регистрация нигде не обязательна. Опциональное предложение завести аккаунт — только на экране подтверждения, одним кликом (пароль уже введённого email).
- **Двойная аудитория.** Retail покупает сразу; wholesale заполняет форму `Request Wholesale Price`. Ссылка на опт присутствует в шапке, в карточке товара (при выборе крупных фасовок), в футере и отдельным баннером на главной.
- **Вариативность по весу — везде.** Селектор фасовки на карточке товара и в quick-view; в каталоге показывается диапазон «from $X.XX».
- **Cart drawer** — выезжает справа на десктопе при добавлении товара; на мобиле — полноэкранный. Прогресс-бар «You're $X away from free shipping».
- **Sticky add-to-cart bar** на мобильной карточке товара.
- **Quick view** — модалка из каталога без ухода со страницы.
- **Empty states обязательны:** пустая корзина, пустой wishlist, нет результатов поиска, нет заказов, нет оптовых заявок, 404. Все они уже нарисованы в макете под `isStates` — сверься.
- **Админка:** дашборд (KPI + график выручки 30 дней + последние заказы + алерты по низким остаткам), товары (список + форма создания/редактирования с вариантами), заказы (список + детальная + смена статуса + трек-номер), оптовые заявки (со статусами и заметками), клиенты, промокоды, настройки. Роли: owner / manager / support с разными правами.

---

## 6. Фазы работы

Каждая фаза = отдельный PR-подобный набор коммитов + отчёт о проверках.

### Фаза 0 — Фундамент

Монорепо, pnpm, Turborepo, TypeScript strict, ESLint + Prettier, Husky + lint-staged, commitlint. `docker-compose.dev.yml` с MySQL 8, Redis 7, Mailpit. `.env.example` со всеми переменными и комментариями. `CLAUDE.md` с архитектурными решениями. `BACKLOG.md`.

**Acceptance:** `pnpm install && docker compose up -d && pnpm typecheck && pnpm lint` проходит с нуля на чистой машине.

### Фаза 1 — Дизайн-система

`packages/ui`: токены, Tailwind preset, подключение шрифтов (self-hosted через `@fontsource`, не CDN — важно для производительности и приватности), Phosphor-иконки. Компоненты: Button (4 варианта × 3 размера × состояния), Input, Select, Checkbox, Radio, Textarea, Badge, Card, Modal, Drawer, Tabs, Accordion, Toast, Skeleton, Pagination, Breadcrumb, StarRating, QuantityStepper, PriceTag, Diamond, EmptyState.

**Acceptance:** Storybook собирается, все компоненты отрендерены, визуально совпадают с макетом. Проверка контраста — все текстовые пары ≥ 4.5:1.

### Фаза 2 — Бэкенд: ядро

Fastify-приложение, Drizzle-схема, миграции, сиды (минимум 30 реальных товаров — Devzira rice, Lagman noodle kit, Samarkand non, курага из Ферганы, маш, нут, чечевица; используй названия и тексты из макета, не выдумывай Lorem). Auth (customer + admin), health-чек, OpenAPI-документация через `@fastify/swagger`.

**Acceptance:** миграции применяются и откатываются; сиды наполняют БД; интеграционные тесты на auth зелёные; Swagger UI доступен на `/docs`.

### Фаза 3 — Бэкенд: каталог и корзина

Эндпоинты каталога с фильтрами (категория, цена, вес, происхождение, сертификаты), сортировкой, пагинацией. Поиск с подсказками. Корзина на стороне клиента + серверная валидация цен и остатков перед чекаутом (**никогда не доверяй цене, пришедшей с фронта** — пересчитывай по БД).

**Acceptance:** тесты на фильтрацию и пересчёт корзины; попытка подменить цену в запросе возвращает 422.

### Фаза 4 — Бэкенд: заказы и платежи

Checkout-флоу, Stripe PaymentIntent, PayPal Orders, вебхуки с идемпотентностью, генерация номера заказа, письма (Mailpit локально, Resend/Postmark в проде), транзакционное списание остатков.

**Acceptance:** прогон в Stripe test mode: успешная оплата, отказ карты (`4000 0000 0000 0002`), 3DS (`4000 0025 0000 3155`), повторный вебхук не создаёт дубль. Все сценарии покрыты тестами.

### Фаза 5 — Фронт: витрина

Все публичные экраны по макету. TanStack Router с типизированными роутами, TanStack Query для данных, Zustand для корзины (persist в localStorage). SEO: react-helmet-async, JSON-LD (`Product`, `Organization`, `BreadcrumbList`, `Recipe`), sitemap.xml, robots.txt, канонические URL, Open Graph.

**Acceptance:** каждый экран сверен с макетом по цветам, отступам, типографике. Адаптив на 375 / 768 / 1024 / 1440. Lighthouse ≥ 90 по Performance, ≥ 95 по Accessibility и SEO. Клавиатурная навигация работает во всех модалках, фокус-ловушка в Drawer и Modal, `Esc` закрывает.

### Фаза 6 — Фронт: чекаут и оптовая форма

Чекаут одной страницей с прогресс-индикатором, Stripe Payment Element, PayPal-кнопка, валидация адреса, промокод, страница подтверждения, трекинг заказа. Оптовая форма с honeypot + rate limit против спама.

**Acceptance:** сквозной тест Playwright: каталог → карточка → корзина → чекаут → оплата тестовой картой → подтверждение. Заказ появился в БД с корректными суммами.

### Фаза 7 — Админка

Все разделы, RBAC, аудит-лог действий администраторов, загрузка изображений (S3-совместимое хранилище; локально — MinIO), массовые операции с ценами.

**Acceptance:** e2e-сценарий: создать товар с двумя вариантами → он виден в каталоге → оформить заказ → изменить статус на shipped → клиенту ушло письмо (видно в Mailpit) → оптовая заявка переведена в `contacted` с заметкой.

### Фаза 8 — Локальная приёмка (ключевая фаза, не пропускать)

- `pnpm test` — unit + integration, покрытие бизнес-логики (Money, расчёт корзины, промокоды, налог, вебхуки) ≥ 80%
- `pnpm test:e2e` — Playwright, все критические пути
- `pnpm typecheck` — ноль ошибок, `strict: true`, никаких `any` и `@ts-ignore` в новом коде
- `pnpm build` — все приложения собираются, размер main-бандла `web` < 250 KB gzip
- Lighthouse CI на Home, Shop, Product, Cart — пороги из фазы 5
- Прогон с пустой БД: миграции + сиды + запуск + smoke-тест
- Проверка безопасности: `pnpm audit`, отсутствие секретов в репозитории (`gitleaks`), CORS настроен по whitelist, CSP-заголовки, `helmet`, SQL только через Drizzle (никакой конкатенации), проверка что webhook-эндпоинты не за CSRF и не за auth, но с проверкой подписи

**Acceptance:** одна команда `pnpm verify` прогоняет всё вышеперечисленное и завершается с кодом 0. Пока она красная — фаза 9 не начинается.

### Фаза 9 — Подготовка к деплою

Целевая среда: **Ubuntu 24.04 VPS, Nginx + PM2, MySQL 8, Redis, Let's Encrypt.**

Подготовь:

- `ecosystem.config.cjs` для PM2: `api` в cluster mode (instances по числу ядер), graceful reload, `max_memory_restart`
- Nginx-конфиг: reverse proxy на api, отдача статики `web` и `admin` с правильными `Cache-Control` (immutable для хешированных ассетов, no-cache для index.html), gzip + brotli, HTTP/2, редирект на HTTPS, отдельный `location` для `/.well-known/`, `client_max_body_size` под загрузку изображений
- `Dockerfile` для api (multi-stage, non-root user, distroless или alpine)
- GitHub Actions: lint → typecheck → test → build → deploy по SSH с health-check и автоматическим откатом при неудаче
- Скрипты: `scripts/deploy.sh`, `scripts/rollback.sh`, `scripts/backup-db.sh` (mysqldump + ротация 14 дней + выгрузка в S3)
- `.env.production.example`
- Мониторинг: `/health` (liveness) и `/ready` (проверка MySQL + Redis), Sentry на фронте и бэке, uptime-чек
- `DEPLOY.md` — пошаговая инструкция от чистого VPS до работающего сайта: установка Node через nvm, MySQL, Redis, Nginx, certbot, firewall (ufw: 22/80/443), fail2ban, создание deploy-пользователя, настройка systemd для PM2

**Acceptance:** `DEPLOY.md` проверен последовательным выполнением на чистой машине (можно локально в Docker, эмулируя VPS). Все команды рабочие и скопированные один в один, без «здесь замените на своё».

---

## 7. Чего делать нельзя

- Не подключай Radix/shadcn/MUI/Chakra «чтобы быстрее» — компоненты пишем свои по макету. Единственное исключение: `@floating-ui/react` для позиционирования поповеров и `react-aria` хуки, если понадобится доступность фокуса.
- Не храни ключи Stripe/PayPal на фронте (кроме publishable key).
- Не рассчитывай итоговую сумму на клиенте как источник истины.
- Не делай "оптимистичный" статус заказа по редиректу — только вебхук.
- Не используй `localStorage` для чувствительных данных.
- Не коммить `.env`, дампы БД, `node_modules`, содержимое `uploads/`.
- Не добавляй фичи, которых нет в макете и в этом документе, без вопроса.

---

## 8. Что мне нужно от тебя прямо сейчас

Не начинай писать код. Сначала:

1. Прочитай handoff-бандл целиком, как описано в разделе 1.
2. Составь `PLAN.md`: разбивка по 9 фазам с конкретными задачами внутри каждой и оценкой в часах.
3. Выпиши список вопросов, где макет и это ТЗ расходятся или чего-то не хватает (например: нужен ли multi-currency, какой почтовый провайдер в проде, есть ли реальные фото товаров или используем плейсхолдеры, какой домен, будет ли блог).
4. Покажи предлагаемую структуру `packages/contracts` — Zod-схемы для 3–4 ключевых сущностей, чтобы я сверил подход к типизации до того, как ты размножишь его на весь проект.

После моего «ок» — начинаешь Фазу 0.
