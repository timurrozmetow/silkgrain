# `packages/contracts` — предлагаемая структура и подход к типизации

Черновик на сверку **до** того, как я размножу подход на весь проект.
Показаны 4 ключевые сущности: `Money`, `Product`, `Checkout` (пересчёт корзины + создание заказа), `WholesaleRequest`.

---

## 1. Структура пакета

```
packages/contracts/
├── package.json              # "exports": { ".": …, "./money": …, "./errors": … }
├── src/
│   ├── index.ts              # публичный ре-экспорт
│   ├── primitives.ts         # Email, Slug, Cents, Id, IsoDate, UsState, Zip, Phone
│   ├── money.ts              # value object Money (не Zod — обычный класс)
│   ├── errors.ts             # ErrorCode enum + ApiErrorSchema
│   ├── pagination.ts         # PageQuery / PageMeta / paginated()
│   ├── enums.ts              # OrderStatus, Origin, WeightUnit, BusinessType, …
│   └── modules/
│       ├── catalog.ts        # Category, Product, ProductVariant, ProductDetail, ProductListQuery
│       ├── cart.ts           # CartLineInput, CartQuote
│       ├── checkout.ts       # CheckoutIntentInput, CheckoutIntentResult, Address
│       ├── order.ts          # Order, OrderItem, OrderLookupQuery
│       ├── wholesale.ts      # WholesaleRequestInput, WholesaleRequest, WholesaleStatus
│       ├── auth.ts           # Register, Login, RefreshResult
│       ├── review.ts
│       ├── recipe.ts
│       ├── promo.ts
│       └── admin/…           # админские схемы отдельным неймспейсом
└── tsconfig.json
```

**Правила, которые держим по всему пакету:**

1. Одна схема — два потребителя. Бэк: `fastify-type-provider-zod`, схема идёт и в валидацию, и в OpenAPI. Фронт: `zodResolver` в react-hook-form + `z.infer` для типов ответов.
2. **Раздельные схемы `Input` и `Output`.** Никогда не одна на оба направления: у входа нет `id`/`createdAt`, у выхода нет `password`. Наследование через `.pick()`/`.omit()`/`.extend()`, а не копипастой.
3. Все деньги — `Cents` (`z.number().int().nonnegative()`) + отдельное `currency: 'USD'`. Никаких `float`, никаких строк с `$`.
4. Тип выводим из схемы (`z.infer`), а не пишем руками. Ручной `interface` рядом со схемой — источник расхождений.
5. `.strict()` на всех входных схемах — лишнее поле в теле запроса это ошибка, а не «проигнорируем».
6. Enum'ы — единый источник: `z.enum([...])` + `export type X = z.infer<…>` + тот же массив уходит в Drizzle `mysqlEnum`.

---

## 2. `primitives.ts` и `money.ts`

```ts
// primitives.ts
import { z } from 'zod';

export const Id = z.number().int().positive();
export const Cents = z.number().int().nonnegative();
export const Slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const Email = z.string().trim().toLowerCase().email().max(254);
export const IsoDate = z.string().datetime({ offset: true });
export const Zip = z.string().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid US ZIP code');
export const Phone = z.string().regex(/^\+?1?[-. ]?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/);
export const UsState = z.enum(['AL', 'AK', 'AZ', /* …51 значение, включая DC… */ 'WY']);

export const Currency = z.literal('USD'); // см. Q-39 — мультивалютности нет
export type Cents = z.infer<typeof Cents>;
```

```ts
// money.ts — value object, не Zod. Иммутабельный, только целые центы.
export class Money {
  private constructor(
    readonly cents: number,
    readonly currency: 'USD' = 'USD',
  ) {
    if (!Number.isSafeInteger(cents))
      throw new RangeError(`Money: not an integer cent value: ${cents}`);
  }

  static fromCents(cents: number, currency: 'USD' = 'USD'): Money {
    return new Money(cents, currency);
  }
  static zero(currency: 'USD' = 'USD'): Money {
    return new Money(0, currency);
  }

  /** Только для сидов и админских форм. В рантайме деньги приходят уже в центах. */
  static parse(input: string): Money {
    const m = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
    if (!m) throw new RangeError(`Money.parse: cannot parse "${input}"`);
    return new Money(Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0')));
  }

  private same(o: Money): void {
    if (o.currency !== this.currency)
      throw new TypeError(`Money: currency mismatch ${this.currency}/${o.currency}`);
  }

  add(o: Money): Money {
    this.same(o);
    return new Money(this.cents + o.cents, this.currency);
  }
  subtract(o: Money): Money {
    this.same(o);
    return new Money(this.cents - o.cents, this.currency);
  }

  /** Умножение на количество — только на целое. Дробные множители → allocate/percentage. */
  multiply(qty: number): Money {
    if (!Number.isSafeInteger(qty) || qty < 0)
      throw new RangeError(`Money.multiply: bad qty ${qty}`);
    return new Money(this.cents * qty, this.currency);
  }

  /** Процент со сколько-угодно знаками. Банковское округление, чтобы скидки не «уплывали». */
  percentage(percent: number): Money {
    return new Money(roundHalfEven((this.cents * percent) / 100), this.currency);
  }

  /**
   * Разложить сумму по долям без потери центов: allocate([1,1,1]) от 100¢ → [34,33,33].
   * Нужно для распределения скидки по позициям заказа и для пропорционального возврата.
   */
  allocate(ratios: readonly number[]): Money[] {
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new RangeError('Money.allocate: ratios must sum to a positive number');
    const shares = ratios.map((r) => Math.floor((this.cents * r) / total));
    let rest = this.cents - shares.reduce((a, b) => a + b, 0);
    for (let i = 0; rest > 0; i = (i + 1) % shares.length, rest--) shares[i]! += 1;
    return shares.map((c) => new Money(c, this.currency));
  }

  isZero(): boolean {
    return this.cents === 0;
  }
  gte(o: Money): boolean {
    this.same(o);
    return this.cents >= o.cents;
  }
  format(locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: this.currency }).format(
      this.cents / 100,
    );
  }
  toJSON(): { amount: number; currency: 'USD' } {
    return { amount: this.cents, currency: this.currency };
  }
}
```

Почему `allocate` обязателен: скидка 12 % на набор из трёх товаров ($55.99 → $49.00 из макета) должна лечь на позиции так, чтобы сумма позиций совпала с итогом до цента. Без явного распределения возникает «пропавший цент», который потом ломает сверку со Stripe.

---

## 3. `errors.ts`

```ts
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'CART_PRICE_MISMATCH', // клиент прислал цену, отличную от БД → 422
  'CART_ITEM_UNAVAILABLE', // вариант деактивирован
  'INSUFFICIENT_STOCK',
  'PROMO_INVALID',
  'PROMO_EXPIRED',
  'PROMO_MIN_ORDER_NOT_MET',
  'PROMO_USAGE_LIMIT_REACHED',
  'PAYMENT_FAILED',
  'PAYMENT_AMOUNT_MISMATCH',
  'WEBHOOK_SIGNATURE_INVALID',
  'INTERNAL',
]);

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
```

---

## 4. Сущность 1 — `catalog.ts`

```ts
export const Origin = z.enum(['UZ', 'TM', 'KZ', 'KG', 'TJ', 'MIXED']); // см. Q-15
export const WeightUnit = z.enum(['lb', 'oz', 'g', 'kit']); // см. Q-13
export const Certification = z.enum(['organic', 'non_gmo', 'halal', 'kosher']);
export const Badge = z.enum(['bestseller', 'new', 'sale', 'organic', 'premium']); // см. Q-16
export const StockState = z.enum(['in', 'low', 'out']);

export const ProductVariant = z.object({
  id: Id,
  sku: z.string().min(1).max(64),
  weightValue: z.number().positive(),
  weightUnit: WeightUnit,
  weightLabel: z.string(), // «5 lb», «8 oz», «1 kit» — то, что видит пользователь
  priceCents: Cents,
  compareAtPriceCents: Cents.nullable(), // заполнен → бейдж Sale
  stockQty: z.number().int().nonnegative(),
  stockState: StockState, // производное от stockQty и lowStockThreshold
  isDefault: z.boolean(),
});

/** Карточка в каталоге. Ровно те поля, что рисует ProductCardPremium — не больше. */
export const ProductCard = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  blurb: z.string(),
  category: z.object({ slug: Slug, name: z.string() }),
  image: z.object({ url: z.string().url(), alt: z.string() }).nullable(),
  badges: z.array(Badge),
  rating: z.number().min(0).max(5).nullable(),
  reviewsCount: z.number().int().nonnegative(),
  stockState: StockState,
  weightLabels: z.array(z.string()), // «2 lb · 5 lb · 10 lb» под именем
  priceFromCents: Cents, // «from $14.99»
  priceToCents: Cents,
  currency: Currency,
});

/** Карточка товара целиком. Расширяет ProductCard, не дублирует его. */
export const ProductDetail = ProductCard.extend({
  subtitle: z.string().nullable(),
  description: z.string(), // markdown
  story: z.string().nullable(),
  origin: Origin,
  originRegion: z.string().nullable(), // «Fergana Valley, Uzbekistan»
  images: z.array(z.object({ url: z.string().url(), alt: z.string(), isPrimary: z.boolean() })),
  variants: z.array(ProductVariant).min(1),
  certifications: z.array(Certification),
  nutrition: z
    .object({
      servingSize: z.string(),
      servingsPerContainer: z.number().int().positive().nullable(),
      calories: z.number().int(),
      fatG: z.number(),
      carbsG: z.number(),
      proteinG: z.number(),
      fiberG: z.number(),
      sodiumMg: z.number().int(),
      ingredientsText: z.string(),
      allergensText: z.string(),
    })
    .nullable(),
  seo: z.object({ metaTitle: z.string().nullable(), metaDescription: z.string().nullable() }),
});

/** Запрос каталога. coerce — потому что приходит из query string. */
export const ProductListQuery = z
  .object({
    category: z.array(Slug).optional(),
    origin: z.array(Origin).optional(),
    cert: z.array(Certification).optional(),
    weight: z.array(z.string()).optional(), // «1 lb», «2 lb», …
    priceMinCents: z.coerce.number().int().nonnegative().optional(),
    priceMaxCents: z.coerce.number().int().nonnegative().optional(),
    q: z.string().trim().min(1).max(120).optional(),
    sort: z
      .enum(['featured', 'price_asc', 'price_desc', 'newest', 'bestselling'])
      .default('featured'),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(48).default(16), // в макете 16 на странице
  })
  .strict()
  .refine((v) => !(v.priceMinCents && v.priceMaxCents) || v.priceMinCents <= v.priceMaxCents, {
    message: 'priceMin must be ≤ priceMax',
    path: ['priceMinCents'],
  });
```

Обрати внимание: `ProductCard` — не «урезанный `ProductDetail`», а самостоятельная схема, от которой `ProductDetail` наследуется. Это даёт лёгкий ответ каталога (сетка из 16 карточек не тащит нутриенты и историю) и невозможность случайно вернуть с карточки поле, которого там быть не должно.

---

## 5. Сущность 2 — `cart.ts` (сервер как единственный источник цены)

```ts
/** Что присылает клиент. Цены в запросе НЕТ вообще — её неоткуда подделать. */
export const CartLineInput = z
  .object({
    variantId: Id,
    qty: z.number().int().min(1).max(99),
  })
  .strict();

export const CartQuoteInput = z
  .object({
    lines: z.array(CartLineInput).min(1).max(50),
    promoCode: z.string().trim().toUpperCase().min(3).max(32).optional(),
    shippingMethod: z.enum(['standard', 'express', 'overnight']).default('standard'),
  })
  .strict();

/** Что возвращает сервер — всё пересчитано по БД. */
export const CartQuoteLine = z.object({
  variantId: Id,
  productSlug: Slug,
  name: z.string(),
  weightLabel: z.string(),
  image: z.string().url().nullable(),
  qty: z.number().int().positive(),
  unitPriceCents: Cents,
  lineTotalCents: Cents,
  stockState: StockState,
  availableQty: z.number().int().nonnegative(),
});

export const CartQuote = z.object({
  lines: z.array(CartQuoteLine),
  itemCount: z.number().int().nonnegative(),
  subtotalCents: Cents,
  discountCents: Cents,
  shippingCents: Cents,
  /** null до ввода адреса — в корзине показываем «Calculated at checkout» (Q-21). */
  taxCents: Cents.nullable(),
  totalCents: Cents,
  currency: Currency,
  promo: z
    .object({
      code: z.string(),
      type: z.enum(['percent', 'fixed', 'free_shipping']),
      discountCents: Cents,
    })
    .nullable(),
  freeShipping: z.object({
    thresholdCents: Cents,
    remainingCents: Cents,
    progressPercent: z.number().min(0).max(100),
  }),
  adjustments: z.array(
    z.object({
      // что сервер поправил молча, чтобы фронт показал тост
      variantId: Id,
      reason: z.enum([
        'price_changed',
        'qty_reduced',
        'removed_unavailable',
        'removed_out_of_stock',
      ]),
      message: z.string(),
    }),
  ),
});
```

Ключевое решение: **`CartLineInput` не содержит цены**. Требование ТЗ «попытка подменить цену возвращает 422» я закрываю не сравнением присланной цены с БД, а тем, что присылать цену просто негде — схема со `.strict()` отвергнет лишнее поле. Код `CART_PRICE_MISMATCH` остаётся для другого случая: клиент нажал «Place Order» с суммой, которая устарела, пока он заполнял форму (проверка `expectedTotalCents` в `CheckoutIntentInput` ниже).

---

## 6. Сущность 3 — `checkout.ts` / `order.ts`

```ts
export const Address = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: UsState,
    zip: Zip,
    country: z.literal('US'),
    phone: Phone.optional(),
  })
  .strict();

export const CheckoutIntentInput = z
  .object({
    email: Email,
    lines: z.array(CartLineInput).min(1).max(50),
    shippingAddress: Address,
    billingAddress: Address.optional(), // отсутствует ⇒ «same as shipping»
    shippingMethod: z.enum(['standard', 'express', 'overnight']),
    promoCode: z.string().trim().toUpperCase().max(32).optional(),
    marketingOptIn: z.boolean().default(false),
    provider: z.enum(['stripe', 'paypal']),
    /** Сумма, которую пользователь видел на экране. Расходится с пересчётом → 409, а не молчаливое списание. */
    expectedTotalCents: Cents,
  })
  .strict();

export const CheckoutIntentResult = z.object({
  orderNumber: z.string(), // формат — Q-20
  quote: CartQuote,
  payment: z.discriminatedUnion('provider', [
    z.object({
      provider: z.literal('stripe'),
      clientSecret: z.string(),
      publishableKey: z.string(),
    }),
    z.object({ provider: z.literal('paypal'), paypalOrderId: z.string() }),
  ]),
});

export const OrderStatus = z.enum([
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

/** Снимок позиции. Все поля скопированы на момент заказа и потом не меняются. */
export const OrderItem = z.object({
  productId: Id.nullable(), // товар могли удалить — снимок это переживает
  variantId: Id.nullable(),
  productSlug: Slug.nullable(),
  name: z.string(),
  sku: z.string(),
  weightLabel: z.string(),
  imageUrl: z.string().url().nullable(),
  unitPriceCents: Cents,
  qty: z.number().int().positive(),
  lineTotalCents: Cents,
});

export const Order = z.object({
  orderNumber: z.string(),
  status: OrderStatus,
  email: Email,
  items: z.array(OrderItem).min(1),
  subtotalCents: Cents,
  discountCents: Cents,
  shippingCents: Cents,
  taxCents: Cents,
  totalCents: Cents,
  currency: Currency,
  promoCode: z.string().nullable(),
  shippingMethod: z.enum(['standard', 'express', 'overnight']),
  shippingAddress: Address,
  billingAddress: Address,
  payment: z
    .object({
      provider: z.enum(['stripe', 'paypal']),
      brand: z.string().nullable(), // «Visa»
      last4: z.string().length(4).nullable(), // только это — PAN у нас не бывает никогда
    })
    .nullable(),
  tracking: z
    .object({ carrier: z.string(), number: z.string(), url: z.string().url().nullable() })
    .nullable(),
  createdAt: IsoDate,
  paidAt: IsoDate.nullable(),
  shippedAt: IsoDate.nullable(),
  deliveredAt: IsoDate.nullable(),
  estimatedDelivery: z.object({ from: IsoDate, to: IsoDate }).nullable(),
});

/** Гостевой доступ к заказу: номер + email, иначе перебором читаются чужие заказы (Q-25). */
export const OrderLookupQuery = z.object({ orderNumber: z.string(), email: Email }).strict();
```

---

## 7. Сущность 4 — `wholesale.ts`

Поля выставлены по **ТЗ**; расхождение с макетом зафиксировано в Q-27 и правится одним движением, когда ответишь.

```ts
export const BusinessType = z.enum(['restaurant', 'grocery', 'distributor', 'meal_kit', 'other']);
export const VolumeBand = z.enum(['50-200', '200-500', '500-2000', '2000+']); // список — Q-27
export const WholesaleStatus = z.enum(['new', 'contacted', 'quoted', 'converted', 'declined']);

export const WholesaleRequestInput = z
  .object({
    businessName: z.string().trim().min(2).max(200),
    businessType: BusinessType,
    contactFirstName: z.string().trim().min(1).max(80),
    contactLastName: z.string().trim().min(1).max(80),
    email: Email,
    phone: Phone.optional(),
    address: Address.omit({ firstName: true, lastName: true, phone: true }).optional(), // Q-27
    categoriesOfInterest: z.array(Slug).min(1).max(12),
    monthlyVolumeBand: VolumeBand,
    notes: z.string().trim().max(2000).optional(),

    // антиспам (Фаза 6). Оба поля не показываются пользователю.
    website: z.literal('').optional(), // honeypot: заполнено → тихо 200, в БД не пишем
    formRenderedAt: z.coerce.number().int().positive(), // сабмит быстрее 3 с → бот
  })
  .strict();

export const WholesaleRequest = WholesaleRequestInput.omit({
  website: true,
  formRenderedAt: true,
}).extend({
  id: Id,
  status: WholesaleStatus,
  assignedTo: z.object({ id: Id, name: z.string() }).nullable(),
  notesLog: z.array(
    z.object({
      id: Id,
      body: z.string(),
      authorName: z.string(),
      createdAt: IsoDate,
    }),
  ),
  createdAt: IsoDate,
});
```

Здесь видно приём, который дальше применяю везде: админская схема чтения строится из клиентской схемы записи через `.omit().extend()`. Поля антиспама физически не могут утечь в ответ, а бизнес-поля не могут разъехаться между формой и админкой — они буквально одни и те же.

---

## 8. Как это подключается

```ts
// apps/api — схема и валидирует, и документирует
app.withTypeProvider<ZodTypeProvider>().post(
  '/api/wholesale',
  {
    schema: {
      tags: ['wholesale'],
      body: WholesaleRequestInput,
      response: { 201: z.object({ id: Id }), 422: ApiError, 429: ApiError },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  },
  handler,
);
```

```tsx
// apps/web — та же схема в форме, ноль ручных типов
const form = useForm<z.input<typeof WholesaleRequestInput>>({
  resolver: zodResolver(WholesaleRequestInput),
  defaultValues: { formRenderedAt: Date.now(), website: '' },
});
```

---

## Что мне нужно от тебя по этому файлу

1. Согласен с разделением `Input` / `Output` и наследованием через `.pick()/.omit()/.extend()` вместо параллельных схем?
2. Согласен, что цена **никогда** не приходит от клиента, а `expectedTotalCents` служит только для 409 при устаревшей сумме?
3. `Money` — отдельный класс, а по проводу летят голые `…Cents: number` + `currency`. Или хочешь, чтобы API отдавал объект `{ amount, currency }` для каждой суммы (читаемее, но многословнее и тяжелее)?
4. Именование в JSON — `camelCase` (как выше) или `snake_case` под стать колонкам БД? Я за `camelCase` на границе API и маппинг в Drizzle.
5. Ответы на Q-13, Q-15, Q-16, Q-20, Q-27 напрямую меняют enum'ы в этом файле — без них схемы придётся переписывать.
