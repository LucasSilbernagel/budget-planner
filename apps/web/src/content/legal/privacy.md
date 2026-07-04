_This page is informational and does not constitute legal advice._

_Last updated: 3 July 2026_

This Privacy Policy explains what data Budget Planner ("we", "the Service") handles and how.
We have designed the Service to collect as little personal data as possible.

## Who is responsible for your data

The data controller for the Service is **Lucas Silbernagel**, an individual operating from Toronto, Ontario, Canada.
You can reach the controller for any privacy request through the [contact form](/contact).

## Free tier: your data stays on your device

If you use Budget Planner without an account, **all of your financial data is stored locally in your browser** (in its local storage).
It is never transmitted to us and we never have access to it.
Clearing your browser data clears your Budget Planner data.

## Premium tier: EU-hosted sync

If you create a Premium account, your financial data is stored so it can be synced across your devices.
**Your financial data is hosted exclusively on DanubeData infrastructure in Germany (EU); we do not store or process it in the United States.**
Some third parties we rely on operate outside the EU — most notably our payment processor, **Paddle (United Kingdom)** — and handle only the limited data needed for their function, as described below.

## Cookies and device storage

We keep on-device storage to the minimum needed to run the Service, and we do **not** use advertising or cross-site tracking cookies.
What we store on your device falls into a few strictly-necessary or functional categories:

- **Sign-in cookies (Premium only)** — when you log in, we set a `session` cookie and a short-lived `ml_csrf` login-security cookie.
  Both are `HttpOnly`, `SameSite=Lax`, and `Secure` in production, and exist only to keep you signed in and protect the login flow.
- **Your free-tier data** — as described above, your budget data is stored on your own device because on-device storage *is* the free service you asked for.
- **Display preferences** — your theme and currency choices are saved locally so the app remembers them.
- **Analytics marker** — our privacy-friendly analytics writes a single non-identifying `_swa` marker (see "Analytics" below).

Because every one of these is either strictly necessary, a service you explicitly requested, a functional preference you set, or privacy-preserving audience measurement, **we do not show a cookie-consent banner**.

## Payments

Subscriptions are processed by **Paddle.com** (our Merchant of Record).
When you subscribe, Paddle collects the information needed to take payment (such as billing details).
We do not receive or store your full payment-card details.
Please refer to Paddle's own privacy notice for how they handle payment data.

## Sign-in emails

When you sign in with a magic link, we send that email through **Brevo (Sendinblue)**, an email provider based in France (EU).
Brevo receives only the email address needed to deliver your login link and never receives your financial data.

## Contact form

When you use our [contact form](/contact), your message is delivered through **Formspark** (`submit-form.com`).
Formspark stores submissions in Ireland (EU) but relies on a US-based subprocessor (AWS), so this is one narrowly-scoped path where data may be handled outside the EU.
It carries only the free-text feedback you choose to send — never your financial data — and you control what you put in it.

## Advertising

Visitors who are not signed in may see ads served by **EthicalAds**, a privacy-respecting ad network.
Per EthicalAds' stated policy, it does not use cookies or personalised tracking; because its script runs as a third party, we disclose it here as a processor for signed-out visitors.
Signed-in Premium users are not shown ads.

## Analytics

We measure aggregate traffic with **counter.dev**, a cookieless, privacy-friendly analytics service.
It records only non-identifying visitor metadata — referrer, screen dimensions, our site identifier, your UTC offset, and the page path — and never any financial or account data.
It writes a single `_swa` marker to your browser's local storage to avoid double-counting a visit, and (per counter.dev) honours the Do-Not-Track browser signal where your browser sends one.
counter.dev's hosting residency is not confirmed to be EU-only, so we treat it as a narrowly-scoped exception to our EU-only posture; it only ever receives the non-identifying metadata above.
We rely on the audience-measurement exemption recognised by the French regulator (CNIL) for this privacy-preserving measurement, which is why no consent banner is required.

## IP addresses and logs

When you interact with our server (for example, signing in), your IP address is processed briefly for security and rate-limiting on the basis of our legitimate interest in protecting the Service.
Our analytics provider also necessarily receives your IP address at the network level in order to serve the request.

## Your rights

Depending on your jurisdiction (including under the GDPR and Canada's PIPEDA), you may have rights to access, correct, export, or delete your personal data.
You can exercise these rights, or ask any question about them, through the [contact form](/contact), which reaches the data controller directly.

- **Free tier** — your data never leaves your device, so you can access, export, or delete it entirely by managing or clearing your browser storage.
- **Premium** — you can delete your account and all of your synced data from within the app; deletion removes your data from our EU database.

## Changes to this policy

We may update this Privacy Policy from time to time.
Material changes will be reflected by updating the "Last updated" date above.

## Privacy questions

Any question about this policy or your data can be raised through our [contact form](/contact).
