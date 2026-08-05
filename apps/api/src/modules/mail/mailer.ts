import nodemailer, { type Transporter } from 'nodemailer';

import type { Env } from '../../env';

import type { RenderedEmail } from './templates';

/**
 * SMTP, and nothing above it.
 *
 * Locally this is Mailpit: it accepts anything, delivers nowhere and has an HTTP API the tests
 * read, so a suite that sends a hundred order confirmations sends them to a box nobody owns.
 * Production points the same transport at whatever provider is chosen (question Q-41); an API
 * client for one of them is a change to this file and nothing else.
 */

export interface OutgoingMail extends RenderedEmail {
  to: string;
}

export interface Mailer {
  send: (message: OutgoingMail) => Promise<void>;
  close: () => Promise<void>;
}

export function createMailer(env: Env): Mailer {
  const transport: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // Mailpit refuses a login it never asked for, so credentials are omitted rather than
    // sent empty. A provider that needs them will have them set.
    ...(env.SMTP_USER.length > 0 ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });

  const from = `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`;

  return {
    send: async (message) => {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(env.MAIL_REPLY_TO.length > 0 ? { replyTo: env.MAIL_REPLY_TO } : {}),
      });
    },
    close: async () => {
      transport.close();
      await Promise.resolve();
    },
  };
}
