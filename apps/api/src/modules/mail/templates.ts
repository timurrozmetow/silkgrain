import { Money, type OrderView } from '@silkgrain/contracts';

/**
 * Transactional email, rendered by hand.
 *
 * No template engine: there are a handful of these, they are the most conservative HTML in the
 * codebase, and a dependency that renders them would still leave every table and inline style
 * to be written. Mail clients are twenty years behind browsers - tables for layout, inline
 * styles only, no flexbox and no external stylesheet - so this file looks nothing like the
 * storefront and should not be made to.
 *
 * Every amount goes through `Money.format`, which is the one place in the repository allowed
 * to construct an `Intl.NumberFormat`.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Palette from the design tokens, inlined because a mail client will not load a stylesheet. */
const GREEN = '#0E6B4A';
const GREEN_DEEP = '#0A2E21';
const SAND = '#F3F0E8';
const INK = '#22201B';
const MUTED = '#6B6455';
const RULE = '#E4E0D1';

/** Escapes everything that reaches the HTML body: a product name is data, not markup. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const usd = (cents: number): string => Money.fromCents(cents).format();

export interface StoreDetails {
  name: string;
  /** Where "view your order" points. */
  webUrl: string;
  supportEmail: string;
}

export function orderConfirmation(order: OrderView, store: StoreDetails): RenderedEmail {
  const trackUrl = `${store.webUrl}/order/${order.orderNumber}`;

  const rows = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid ${RULE};color:${INK};font-size:15px;">
          <strong style="font-weight:600;">${escape(item.name)}</strong><br />
          <span style="color:${MUTED};font-size:13px;">${escape(item.weightLabel)} &middot; ${escape(
            item.sku,
          )}</span>
        </td>
        <td style="padding:14px 0;border-bottom:1px solid ${RULE};color:${MUTED};font-size:14px;text-align:center;">
          &times;${String(item.qty)}
        </td>
        <td style="padding:14px 0;border-bottom:1px solid ${RULE};color:${INK};font-size:15px;text-align:right;white-space:nowrap;">
          ${usd(item.lineTotalCents)}
        </td>
      </tr>`,
    )
    .join('');

  const totalRow = (label: string, amount: string, strong = false) => `
      <tr>
        <td colspan="2" style="padding:6px 0;color:${strong ? INK : MUTED};font-size:${
          strong ? '17px' : '14px'
        };${strong ? 'font-weight:600;' : ''}">${label}</td>
        <td style="padding:6px 0;text-align:right;color:${INK};font-size:${
          strong ? '17px' : '14px'
        };${strong ? 'font-weight:600;' : ''}white-space:nowrap;">${amount}</td>
      </tr>`;

  const address = order.shippingAddress;
  const addressLines = [
    `${address.firstName} ${address.lastName}`,
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.zip}`,
  ].filter((line): line is string => line !== null && line.length > 0);

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${SAND};font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FCFAF4;border:1px solid ${RULE};">
            <tr>
              <td style="background:${GREEN_DEEP};padding:28px 32px;">
                <span style="color:#FCFAF4;font-size:26px;letter-spacing:0.5px;">silk</span><span style="color:#D3A73B;font-size:26px;letter-spacing:0.5px;">grain</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;color:${GREEN};font-size:28px;font-weight:normal;">Thank you for your order</h1>
                <p style="margin:0 0 24px;color:${MUTED};font-size:15px;font-family:Helvetica,Arial,sans-serif;">
                  Order <strong style="color:${INK};">${escape(order.orderNumber)}</strong> is paid and being prepared.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;">
                  ${rows}
                  ${totalRow('Subtotal', usd(order.subtotalCents))}
                  ${
                    order.discountCents > 0
                      ? totalRow(
                          `Discount${order.promoCode === null ? '' : ` (${escape(order.promoCode)})`}`,
                          `&minus;${usd(order.discountCents)}`,
                        )
                      : ''
                  }
                  ${totalRow('Shipping', order.shippingCents === 0 ? 'Free' : usd(order.shippingCents))}
                  ${totalRow('Tax', usd(order.taxCents))}
                  ${totalRow('Total', usd(order.totalCents), true)}
                </table>

                <p style="margin:28px 0 6px;color:${INK};font-size:13px;font-family:Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:1.5px;">
                  Shipping to
                </p>
                <p style="margin:0;color:${MUTED};font-size:15px;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">
                  ${addressLines.map(escape).join('<br />')}
                </p>

                <p style="margin:32px 0 0;">
                  <a href="${escape(trackUrl)}" style="display:inline-block;background:${GREEN};color:#FCFAF4;padding:14px 28px;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:15px;">
                    View your order
                  </a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${RULE};color:${MUTED};font-size:13px;font-family:Helvetica,Arial,sans-serif;">
                Questions? Reply to this email or write to
                <a href="mailto:${escape(store.supportEmail)}" style="color:${GREEN};">${escape(
                  store.supportEmail,
                )}</a>.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // Sent alongside the HTML, not instead of it. Some clients prefer it, some people insist on
  // it, and a spam filter that sees no text alternative scores the message worse.
  const text = [
    `Thank you for your order`,
    ``,
    `Order ${order.orderNumber} is paid and being prepared.`,
    ``,
    ...order.items.map(
      (item) =>
        `  ${item.name} (${item.weightLabel}) x${String(item.qty)}  ${usd(item.lineTotalCents)}`,
    ),
    ``,
    `  Subtotal  ${usd(order.subtotalCents)}`,
    ...(order.discountCents > 0 ? [`  Discount  -${usd(order.discountCents)}`] : []),
    `  Shipping  ${order.shippingCents === 0 ? 'Free' : usd(order.shippingCents)}`,
    `  Tax       ${usd(order.taxCents)}`,
    `  Total     ${usd(order.totalCents)}`,
    ``,
    `Shipping to:`,
    ...addressLines.map((line) => `  ${line}`),
    ``,
    `View your order: ${trackUrl}`,
    ``,
    `Questions? Write to ${store.supportEmail}.`,
  ].join('\n');

  return {
    subject: `${store.name} order ${order.orderNumber} confirmed`,
    html,
    text,
  };
}
