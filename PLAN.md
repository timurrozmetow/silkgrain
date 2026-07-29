# SilkGrain — план работ

**Статус:** черновик на согласование. Код не начат.
**Дата:** 2026-07-29
**Источник истины по дизайну:** `silkgrain-design-prompt/project/SilkGrain Premium.dc.html` (прочитан целиком, 1733 строки).

---

## 0. Что уже установлено фактами

### Бандл лежит не там, где ждёт ТЗ

ТЗ говорит: `silkgrain-design-prompt/` в корне. Фактически:

```
silkgrain/
├── CLAUDE-CODE-PROMPT.md
└── Silkgrain design prompt-handoff/
    └── silkgrain-design-prompt/
        ├── README.md
        └── project/
            ├── SilkGrain Premium.dc.html     217 KB  ← главный макет
            ├── SilkGrain Storefront.dc.html  199 KB  ← v1, старая палитра
            ├── SilkGrain Directions.dc.html   39 KB  ← 12 отклонённых направлений (A–L)
            ├── SilkGrain Palettes.dc.html     27 KB  ← 5 палитр, выбрана №3
            ├── SilkGrain v2.dc.html           30 KB  ← отклонённое направление (оранжевое)
            ├── ProductCardPremium.dc.html            ← используется в Premium
            ├── ProductCard.dc.html                   ← v1
            ├── ProductCardV2.dc.html                 ← для отклонённого v2
            ├── support.js                     57 KB  ← рантайм дизайн-инструмента, не нужен
            ├── audit.html                            ← контрольный лист картинок
            ├── assets/silkgrain-logo.jpeg      99 KB
            └── uploads/
                ├── silkgrain-design-prompt.md        ← исходный бриф
                └── WhatsApp Image 2026-06-23….jpeg   ← побайтово тот же файл, что логотип (MD5 совпадает)
```

Папка перенесена в `silkgrain-design-prompt/` в корне (как в ТЗ) в начале Фазы 0; лишняя обёртка удалена.

**Иерархия истины:** Premium > ProductCardPremium > исходный бриф `silkgrain-design-prompt.md`.
Storefront / v2 / Directions / ProductCard / ProductCardV2 — отклонённые итерации, в реализацию не идут. Storefront — это тот же сайт в старой палитре (#2E5D3A/#C8A84B/#F7F2E8) и без мега-меню, поиска, cart drawer, quick-view, бандла и подписки. Palettes подтверждает выбор: вариант №3 «Яркий изумруд + золото» = ровно токены из ТЗ.

### Окружение машины (проверено)

| Что       | Ожидание ТЗ              | Факт                                                                                | Действие                                       |
| --------- | ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| Node      | —                        | **v26.4.0**                                                                         | ок                                             |
| npm       | —                        | 11.17.0                                                                             | ок                                             |
| pnpm      | обязателен               | **нет**, corepack не на PATH                                                        | `npm i -g pnpm` — не блокер                    |
| Docker    | `docker-compose.dev.yml` | **нет**                                                                             | см. вопрос Q-39                                |
| MySQL     | **8**                    | **MariaDB 10.4.32** (XAMPP, `C:\xampp\mysql`), root доступен                        | см. вопрос Q-40                                |
| Redis     | BullMQ + rate-limit      | **нет**, WSL нет, Memurai нет                                                       | см. вопрос Q-41                                |
| Mailpit   | письма локально          | нет                                                                                 | ставится одним .exe без Docker                 |
| MinIO     | загрузки (Фаза 7)        | нет                                                                                 | ставится одним .exe без Docker                 |
| git       | репозиторий              | git 2.55 есть, **репозиторий не инициализирован**                                   | `git init` в Фазе 0                            |
| sql_mode  | strict                   | `NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION` — **без STRICT_TRANS_TABLES** | выставить strict, иначе тихое обрезание данных |
| collation | —                        | `utf8mb4_general_ci`                                                                | принудительно `utf8mb4_unicode_ci` в схеме     |

Существующие БД на сервере: `bakar`, `directorhub`, `directorhub_test`, `logo_control`, `logo_control_test`, `phpmyadmin`, `test`. Создаю отдельные `silkgrain` и `silkgrain_test`, чужие не трогаю.

### Что реально нарисовано в макете

16 экранов (`isHome`, `isShop`, `isCategory`, `isProduct`, `isCart`, `isCheckout`, `isConfirm`, `isTrack`, `isWholesale`, `isAbout`, `isRecipes`, `isFaq`, `isAccount`, `isWishlist`, `isAdmin`, `isStates`) + оверлеи (mega-menu, search, cart drawer, quick view, announcement bar).

**Только десктоп 1440×1024.** Мобильных макетов в бандле нет ни одного, хотя исходный бриф их требовал. Адаптив 375/768/1024 проектирую сам — см. Q-33.

16 товаров с полными данными (slug, name, cat, catKey, origin, region, rating, reviews, badges, stock, defWeight, tone, icon, blurb, desc, weights[{label,price}]) — реальный контент, беру в сиды as-is и дополняю до 30+.

---

## Фаза 0 — Фундамент — **10–14 ч**

| #    | Задача                                                                                                                                                                                                         | ч   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 0.1  | `git init`, `.gitignore` (node_modules, .env, dist, uploads, *.sql, .turbo), `.gitattributes` (LF), `.editorconfig`                                                                                            | 0.5 |
| 0.2  | Переименовать бандл в `silkgrain-design-prompt/` в корне, не добавлять в .gitignore                                                                                                                            | 0.5 |
| 0.3  | pnpm workspaces + Turborepo: `pnpm-workspace.yaml`, `turbo.json` (pipeline: build/dev/lint/typecheck/test/test:e2e), корневой `package.json` со скриптами и `packageManager`                                   | 2   |
| 0.4  | `packages/config`: базовый `tsconfig` (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes), eslint flat config (typescript-eslint strict-type-checked, import/order, no-floating-promises), prettier | 2.5 |
| 0.5  | Скелеты `apps/web`, `apps/admin` (Vite 5 + React 18 + TS), `apps/api` (Fastify 4 + tsx), `packages/ui`, `packages/contracts` — пустые, но собираемые и типизируемые                                            | 2.5 |
| 0.6  | Husky + lint-staged + commitlint (conventional)                                                                                                                                                                | 1   |
| 0.7  | `docker/docker-compose.dev.yml` (mysql:8, redis:7, mailpit, minio) — пишется по ТЗ, но локально не используется (Docker нет)                                                                                   | 1   |
| 0.8  | `scripts/dev-setup.ps1` — фактический локальный путь: проверка XAMPP MySQL, создание БД `silkgrain`/`silkgrain_test`, установка strict sql_mode, запуск Mailpit/Redis-замены                                   | 2   |
| 0.9  | `.env.example` с комментариями по каждой переменной                                                                                                                                                            | 1   |
| 0.10 | `CLAUDE.md` (архитектурные решения, команды, соглашения), `BACKLOG.md`, `README.md`                                                                                                                            | 1.5 |

**Acceptance:** `pnpm install && pnpm typecheck && pnpm lint` зелёные с нуля; `scripts/dev-setup.ps1` поднимает локальные зависимости без Docker; `docker compose -f docker/docker-compose.dev.yml config` валиден.

---

## Фаза 1 — Дизайн-система — **34–44 ч**

| #    | Задача                                                                                                                                                                                                                                                                                                  | ч   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 1.1  | `packages/ui/tokens.ts` — токены из ТЗ дословно + производные (spacing 4-base, z-index, breakpoints 375/768/1024/1280/1440, motion durations/easings из макета: `.18s`, `.2s`, `.28s cubic-bezier(.22,1,.36,1)`, `.55s`, `.7s cubic-bezier(.65,0,.35,1)`)                                               | 3   |
| 1.2  | Tailwind preset: цвета, шрифты, radius, shadow, container 1280/gutter 28, keyframes `sgUp`/`sgFloat`/`sgFloatB`/`sgGrow`/`sgPop`/`sgShimmer`, обёртка `prefers-reduced-motion`                                                                                                                          | 3   |
| 1.3  | Шрифты self-hosted через `@fontsource`: Cormorant Garamond 500/600/700 (+italic 500 — нужен для «_provenance_» и цитат), DM Serif Display 400 (+italic), Inter 400/500/600/700, DM Mono 400/500. Только latin subset, `font-display: swap`, preload критичных                                           | 2   |
| 1.4  | Слой иконок: `@phosphor-icons/react`, тонкая обёртка `<Icon name="bowl-food" />` с маппингом kebab→компонент (в макете 60+ иконок в формате `ph-*`), `regular` по умолчанию, `fill` для логотипа/звёзд/активных                                                                                         | 2.5 |
| 1.5  | `<Diamond />` (6×6 rotate 45°, gold) + `<Eyebrow />` (DM Mono 11–12px, tracking .18–.28em, uppercase, goldDark) — встречаются на каждом экране                                                                                                                                                          | 1   |
| 1.6  | Button: 4 варианта (primary green / outline green / light-on-dark / gold-outline-on-dark) × 3 размера × hover/focus-visible/disabled/loading. Важно: в макете два разных радиуса кнопок — `6px` (шапка, карточки) и `3px` (хиро, drawer, «Add the set»). Свожу в `radius.sm`/`radius.md` с явным пропом | 3   |
| 1.7  | Формы: Input, Textarea, Select, Checkbox (18×18, radius 4, green fill + bold check), Radio (20×20, точка 10px), фокус-кольцо `0 0 0 3px rgba(74,140,92,0.15)`, error-состояние                                                                                                                          | 4   |
| 1.8  | Badge (Bestseller gold / New green / Sale terracotta / Organic sage / Premium goldDark), PriceTag (DM Mono, «from» eyebrow), StarRating, QuantityStepper                                                                                                                                                | 3   |
| 1.9  | Card, Modal (focus trap, Esc, scroll lock), Drawer (справа 430px / full-screen mobile, focus trap, Esc), Tabs, Accordion, Toast, Skeleton (`sgShimmer`), Pagination, Breadcrumb                                                                                                                         | 6   |
| 1.10 | EmptyState (иконка в круге 78px + заголовок Cormorant 25px + текст + CTA)                                                                                                                                                                                                                               | 1   |
| 1.11 | ProductCard (перенос `ProductCardPremium.dc.html` 1:1: hover lift −6px, image scale 1.07, inset-shadow, badges, wishlist-кнопка, quick-view-кнопка, cat/name/blurb/rating/stock/weights/from-price/add)                                                                                                 | 4   |
| 1.12 | Storybook 8 + stories на всё + `@storybook/addon-a11y`                                                                                                                                                                                                                                                  | 4   |
| 1.13 | Прогон контраста всех текстовых пар (в т.ч. `mutedPale #9A8F78` на `surface #FCFAF4` — **это 2.7:1, ниже 4.5**; понадобится либо утемнение токена, либо перевод в «крупный текст» — см. Q-49)                                                                                                           | 2   |

**Acceptance:** Storybook собирается, все компоненты отрендерены, визуально совпадают с макетом; отчёт по контрасту, все текстовые пары ≥ 4.5:1 (или согласованные исключения).

---

## Фаза 2 — Бэкенд: ядро — **26–34 ч**

| #    | Задача                                                                                                                                                                                                                                              | ч   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 2.1  | Fastify-приложение: плагины (helmet, cors whitelist, compress, sensible, rate-limit, request-context с `requestId`), pino structured JSON, graceful shutdown                                                                                        | 3   |
| 2.2  | Единый формат ошибок `{ error: { code, message, details? } }`, `ErrorCode` enum в `contracts`, errorHandler + notFoundHandler                                                                                                                       | 2   |
| 2.3  | `packages/contracts`: `Money` (BIGINT-центы, add/subtract/multiply/allocate/format), базовые Zod-примитивы, `fastify-type-provider-zod`                                                                                                             | 4   |
| 2.4  | Drizzle-схема: 20 таблиц из ТЗ + `reviews`, `shipping_rates`, `audit_log`, `contact_messages`, `settings` (см. Q-6, Q-26, Q-35). Индексы из ТЗ. Явные `utf8mb4_unicode_ci`, `BIGINT` для денег, CHECK на неотрицательный остаток                    | 6   |
| 2.5  | Миграции `drizzle-kit generate` + проверка apply/rollback **на MariaDB 10.4** (риск: drizzle-kit целится в MySQL 8)                                                                                                                                 | 3   |
| 2.6  | Сиды: 16 товаров из макета дословно + добор до 30+ (Samarkand non, лагман, курага, маш, нут, чечевица…), категории с иконками, 6 рецептов, FAQ, промокод `WELCOME10`, тарифы доставки, admin-пользователи, демо-заказы и оптовые заявки для админки | 5   |
| 2.7  | Auth: Argon2id, JWT access 15 мин + refresh 30 дн (httpOnly/Secure/SameSite=Lax, ротация, `token_hash` в БД, отзыв), раздельные контуры customer и admin, guard'ы, жёсткий rate-limit на `/auth/*`                                                  | 6   |
| 2.8  | `/health` (liveness) и `/ready` (MySQL + Redis)                                                                                                                                                                                                     | 1   |
| 2.9  | `@fastify/swagger` + Swagger UI на `/docs`, генерация из Zod                                                                                                                                                                                        | 2   |
| 2.10 | Vitest + тестовая БД `silkgrain_test`, хелперы, интеграционные тесты auth (регистрация, логин, ротация refresh, отзыв, брутфорс)                                                                                                                    | 4   |

**Acceptance:** миграции применяются и откатываются на MariaDB 10.4; сиды наполняют БД; тесты auth зелёные; Swagger UI на `/docs`.

---

## Фаза 3 — Бэкенд: каталог и корзина — **22–28 ч**

| #   | Задача                                                                                                                                                                                                              | ч   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 3.1 | `GET /api/categories` (дерево + счётчики из БД)                                                                                                                                                                     | 1.5 |
| 3.2 | `GET /api/products` — фильтры (category[], priceMin/Max по вариантам, weight[], origin[], cert[], badges), сортировки (featured/price asc/desc/newest/bestselling), keyset-пагинация, агрегат `priceFrom`/`priceTo` | 6   |
| 3.3 | `GET /api/products/:slug` — варианты, изображения, нутриенты, сертификаты, отзывы, «You May Also Like» (та же категория, добор до 4)                                                                                | 3   |
| 3.4 | `GET /api/search/suggest` — подсказки для оверлея поиска (name + cat, лимит 6) + популярные запросы                                                                                                                 | 2.5 |
| 3.5 | `POST /api/cart/validate` — **пересчёт по БД**: цены только из `product_variants`, проверка активности и остатка; расхождение с присланной ценой → 422                                                              | 4   |
| 3.6 | Промокоды: `POST /api/cart/promo` (percent/fixed/free_shipping, min_order, окна дат, лимит использований)                                                                                                           | 3   |
| 3.7 | Тарифы доставки из БД + прогресс «You're $X away from free shipping»                                                                                                                                                | 2   |
| 3.8 | Тесты: фильтрация, сортировка, пагинация, пересчёт корзины, подмена цены → 422, промокоды (граничные суммы, истёкший, исчерпанный)                                                                                  | 5   |

**Acceptance:** тесты на фильтрацию и пересчёт корзины зелёные; подмена цены в запросе возвращает 422.

---

## Фаза 4 — Бэкенд: заказы и платежи — **34–44 ч**

| #   | Задача                                                                                                                                                                                                                                                           | ч   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 4.1 | Генератор `order_number` (формат — Q-20), уникальность с ретраем                                                                                                                                                                                                 | 1   |
| 4.2 | `POST /api/checkout/intent`: валидация Zod → пересчёт по БД → мягкая проверка остатков → создание заказа `pending` + снимок позиций → Stripe PaymentIntent с `metadata.order_id` + `automatic_tax`                                                               | 6   |
| 4.3 | Stripe-вебхуки: `addContentTypeParser` **только** на `/api/webhooks/stripe` для raw body, проверка подписи, идемпотентность через UNIQUE `webhook_events.event_id`, обработчики `payment_intent.succeeded` / `payment_intent.payment_failed` / `charge.refunded` | 6   |
| 4.4 | Транзакция «оплачено»: `pending → paid` + списание остатков + `inventory_movements` одной транзакцией, запрет отрицательного остатка                                                                                                                             | 4   |
| 4.5 | PayPal: Orders v2 (create → capture), **сверка суммы на сервере** перед подтверждением, вебхук `PAYMENT.CAPTURE.COMPLETED`                                                                                                                                       | 6   |
| 4.6 | Stripe Tax `automatic_tax: { enabled: true }`, до адреса — «Calculated at checkout»                                                                                                                                                                              | 2   |
| 4.7 | Очередь писем (BullMQ или замена — Q-41) + шаблоны: подтверждение заказа, отправка, отмена/возврат, оптовая заявка (клиенту и админу)                                                                                                                            | 6   |
| 4.8 | `GET /api/orders/:number` для гостя (номер + email), `GET /api/account/orders` для клиента                                                                                                                                                                       | 3   |
| 4.9 | Тесты Stripe test mode: успех, отказ `4000 0000 0000 0002`, 3DS `4000 0025 0000 3155`, повтор вебхука → без дубля, гонка двух вебхуков, недостаток остатка                                                                                                       | 6   |

**Acceptance:** все четыре сценария Stripe test mode проходят и покрыты тестами; повторный вебхук не создаёт дубль.

---

## Фаза 5 — Фронт: витрина — **70–90 ч**

Базис: TanStack Router (типизированные роуты), TanStack Query, Zustand + persist для корзины/wishlist.

| #    | Экран / задача                                                                                                                                                                                                                      | ч   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 5.1  | Каркас: роутер, layout, announcement bar, sticky header с blur, футер, скролл-ресет, ErrorBoundary                                                                                                                                  | 6   |
| 5.2  | Оверлеи: mega-menu (десктоп hover + тач-паттерн), поисковый оверлей с подсказками, cart drawer (430px / full-screen), quick-view — все с focus trap и Esc                                                                           | 8   |
| 5.3  | `/` Главная: карусель 3 слайда (autoplay 5.5 с, точки, стрелки), хиро с параллаксом 0.12, category strip, Best Sellers, «The Plov Set», 3 value props, Origin story, Wholesale banner, New Arrivals, Testimonials, Subscribe & Save | 12  |
| 5.4  | `/shop` каталог: сайдбар-фильтры 260px sticky, dual-range слайдер цены, сортировка, grid/list, пагинация, синхронизация фильтров с URL                                                                                              | 10  |
| 5.5  | `/shop/c/:slug` категория: хиро-баннер 320px, чипсы подкатегорий, сетка                                                                                                                                                             | 4   |
| 5.6  | `/product/:slug`: галерея + миниатюры, выбор веса, стоки, степпер, add-to-cart, Buy Now, wholesale-нотис, 4 таба (Description / Nutrition Facts в FDA-вёрстке / Origin / Reviews с гистограммой), related                           | 12  |
| 5.7  | `/cart`: строки, степпер, промокод, sticky-сводка, прогресс free shipping, альтернативные кнопки оплаты                                                                                                                             | 6   |
| 5.8  | `/wishlist`, `/recipes` (+ `/recipes/:slug` — макета нет, Q-25), `/about`, `/help` (FAQ-аккордеон + контакт-форма), `/track`, `/account/*`                                                                                          | 12  |
| 5.9  | Empty states (6 шт.) + 404                                                                                                                                                                                                          | 3   |
| 5.10 | SEO: react-helmet-async, JSON-LD (Product/Organization/BreadcrumbList/Recipe), sitemap.xml, robots.txt, canonical, OG                                                                                                               | 5   |
| 5.11 | Адаптив 375/768/1024/1440 по всем экранам (макетов нет — проектирую)                                                                                                                                                                | 10  |
| 5.12 | A11y-проход: клавиатура во всех модалках, focus trap, Esc, skip-link, aria-live на корзину, alt'ы                                                                                                                                   | 5   |

**Acceptance:** каждый экран сверен с макетом по цветам/отступам/типографике; адаптив на 4 брейкпоинтах; Lighthouse ≥ 90 Performance, ≥ 95 A11y и SEO; клавиатурная навигация и фокус-ловушки работают.

---

## Фаза 6 — Фронт: чекаут и оптовая форма — **26–34 ч**

| #   | Задача                                                                                                                     | ч   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --- |
| 6.1 | `/checkout`: прогресс-индикатор 4 шага, секции Contact / Shipping Address / Shipping Method / Payment, sticky-сводка       | 8   |
| 6.2 | Валидация react-hook-form + zodResolver по тем же схемам, что на бэке; US states, ZIP, телефон                             | 4   |
| 6.3 | Stripe Payment Element (Apple Pay / Google Pay внутри него), файл верификации домена Apple Pay в `/.well-known/`           | 5   |
| 6.4 | PayPal JS SDK кнопка                                                                                                       | 3   |
| 6.5 | `/order/:number` подтверждение + опциональная регистрация в один клик; `/track`                                            | 4   |
| 6.6 | `/wholesale`: хиро, 3 бенефита, форма, honeypot + временна́я ловушка + rate-limit, success-состояние                        | 5   |
| 6.7 | Playwright сквозной: каталог → карточка → корзина → чекаут → тестовая карта → подтверждение → заказ в БД с верными суммами | 5   |

**Acceptance:** сквозной e2e зелёный, заказ в БД с корректными суммами.

---

## Фаза 7 — Админка — **44–56 ч**

Нарисованы только Dashboard, Products (список), Orders (список), Wholesale (список). Остальное проектирую в стиле макета — см. Q-28.

| #   | Задача                                                                                                                              | ч   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --- |
| 7.1 | Каркас: sidebar 248px `greenDeep`, топбар, RBAC-роутинг, логин админа                                                               | 6   |
| 7.2 | Dashboard: 4 KPI, SVG area-chart выручки за 30 дней, Low Stock, Recent Orders                                                       | 6   |
| 7.3 | Products: список с поиском/фильтрами + форма создания/редактирования (варианты, нутриенты, сертификаты, SEO, статус)                | 10  |
| 7.4 | Загрузка изображений: drag&drop, S3-совместимое хранилище (локально MinIO), ресайз/webp, сортировка, primary                        | 6   |
| 7.5 | Orders: список со статус-фильтрами + детальная + смена статуса + трек-номер + перевозчик + триггер письма                           | 8   |
| 7.6 | Wholesale: список + детальная + статусы + заметки + назначение ответственного                                                       | 5   |
| 7.7 | Customers, Promo codes, Pricing (массовые операции с ценами), Settings                                                              | 8   |
| 7.8 | RBAC owner/manager/support + аудит-лог действий (Q-29)                                                                              | 5   |
| 7.9 | E2E: создать товар с 2 вариантами → виден в каталоге → заказ → shipped → письмо в Mailpit → оптовая заявка в `contacted` с заметкой | 4   |

**Acceptance:** e2e-сценарий из ТЗ проходит целиком.

---

## Фаза 8 — Локальная приёмка — **26–34 ч**

| #   | Задача                                                                                                                                                              | ч   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 8.1 | Добор unit-покрытия бизнес-логики ≥ 80 % (Money, корзина, промокоды, налог, вебхуки, остатки)                                                                       | 8   |
| 8.2 | Добор Playwright на все критические пути (гость/клиент, оба платёжных провайдера, отказ оплаты)                                                                     | 6   |
| 8.3 | `pnpm typecheck` — 0 ошибок, вычистить `any`/`@ts-ignore`                                                                                                           | 3   |
| 8.4 | `pnpm build`, бюджет main-бандла web < 250 KB gzip (анализ, code splitting по роутам, ленивые модалки)                                                              | 5   |
| 8.5 | Lighthouse CI на Home/Shop/Product/Cart с порогами                                                                                                                  | 3   |
| 8.6 | Прогон с пустой БД: миграции + сиды + запуск + smoke                                                                                                                | 2   |
| 8.7 | Безопасность: `pnpm audit`, `gitleaks`, CORS whitelist, CSP, helmet, ревизия «SQL только через Drizzle», проверка что вебхуки вне CSRF/auth, но с проверкой подписи | 5   |
| 8.8 | `pnpm verify` — одна команда на всё, exit 0                                                                                                                         | 2   |

**Acceptance:** `pnpm verify` завершается с кодом 0.

---

## Фаза 9 — Подготовка к деплою — **24–32 ч**

Целевая среда: Ubuntu 24.04 VPS, Nginx + PM2, MySQL 8, Redis, Let's Encrypt.

| #   | Задача                                                                                                                                                                                                    | ч   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 9.1 | `ecosystem.config.cjs`: api в cluster mode по числу ядер, graceful reload, `max_memory_restart`                                                                                                           | 2   |
| 9.2 | Nginx: reverse proxy, статика web/admin с `Cache-Control` (immutable для хешированных, no-cache для index.html), gzip+brotli, HTTP/2, редирект на HTTPS, `location /.well-known/`, `client_max_body_size` | 4   |
| 9.3 | `Dockerfile` для api (multi-stage, non-root, alpine)                                                                                                                                                      | 2   |
| 9.4 | GitHub Actions: lint → typecheck → test → build → deploy по SSH + health-check + автооткат                                                                                                                | 5   |
| 9.5 | `scripts/deploy.sh`, `rollback.sh`, `backup-db.sh` (mysqldump + ротация 14 дней + выгрузка в S3)                                                                                                          | 4   |
| 9.6 | `.env.production.example`, Sentry на фронте и бэке, uptime-чек                                                                                                                                            | 3   |
| 9.7 | `DEPLOY.md` — от чистого VPS до работающего сайта (nvm, MySQL, Redis, Nginx, certbot, ufw 22/80/443, fail2ban, deploy-пользователь, systemd для PM2), без «здесь замените на своё»                        | 6   |
| 9.8 | Прогон `DEPLOY.md` на чистой машине (эмуляция VPS)                                                                                                                                                        | 4   |

**Acceptance:** `DEPLOY.md` проверен последовательным выполнением, все команды рабочие.

---

## Итог

| Фаза                  | Часы          |
| --------------------- | ------------- |
| 0 — Фундамент         | 10–14         |
| 1 — Дизайн-система    | 34–44         |
| 2 — Бэкенд: ядро      | 26–34         |
| 3 — Каталог и корзина | 22–28         |
| 4 — Заказы и платежи  | 34–44         |
| 5 — Витрина           | 70–90         |
| 6 — Чекаут и опт      | 26–34         |
| 7 — Админка           | 44–56         |
| 8 — Приёмка           | 26–34         |
| 9 — Деплой            | 24–32         |
| **Всего**             | **316–410 ч** |

Оценки — на одного разработчика, без учёта времени на согласования и без фич из `QUESTIONS.md`, которые пока не приняты (бандлы, подписки, лояльность, рефералы, отзывы с пользовательским вводом, адресная книга, сохранённые карты). Каждая из них — отдельные +8…+20 ч.

Фазы 1 и 2 независимы и могут идти параллельно; 5 и 7 зависят от 3/4.
