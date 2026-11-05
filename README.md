# Demisvogue storefront backend

The Node.js API serves the storefront, saves orders and customer messages in MySQL, and sends email notifications to the CEO.

## Requirements

- Node.js 20 or newer
- MySQL 8 or compatible MySQL server
- Paystack account and secret key
- SMTP account for sending email

## Local setup

1. Create a MySQL database named `demisvogue` and a database user with permission to create and update tables.
2. Copy `.env.example` to `.env` and set database, Paystack, SMTP, CEO email, site URL, and admin login values. Use an admin password of at least 16 characters and a random session secret of at least 32 characters. Do not commit `.env` or send secrets in chat.
3. Install packages with `npm install`.
4. Create or update the tables with `npm run db:setup`. This also adds the fulfillment status field to an existing orders table.
5. Start the website and API with `npm start`, then open `http://localhost:3000`.

The API checks its database and SMTP connection at startup. The database setup command must be run before starting the server.

## Deploy the complete store with GitHub and Railway

GitHub is the source-code host; it does not run this Node.js API or its MySQL database. Railway can deploy the app from a connected GitHub repository, host a MySQL service, and provide an HTTPS `*.up.railway.app` URL. Hosting providers may charge for usage; check current plans before deploying.

1. Create a private GitHub repository and upload the project. Keep `.env`, `node_modules`, and `uploads` out of Git; `.gitignore` already excludes them. Do not upload payment proofs or credentials.
2. In Railway, create a project from that GitHub repository and add a MySQL service. Grant Railway's GitHub app access to the repository.
3. In the app service, map these variables to the MySQL service (replace `MySQL` if you named that service differently):
   - `DB_HOST=${{MySQL.MYSQLHOST}}`
   - `DB_PORT=${{MySQL.MYSQLPORT}}`
   - `DB_NAME=${{MySQL.MYSQLDATABASE}}`
   - `DB_USER=${{MySQL.MYSQLUSER}}`
   - `DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}`
4. Set app variables in Railway: `NODE_ENV=production`, `SITE_URL` to the final HTTPS app URL, `UPLOAD_DIR=/app/uploads/private`, `PAYSTACK_SECRET_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `CEO_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`. Keep all credentials in Railway's private variables panel, never in GitHub or chat. Use a unique admin password (16+ characters) and a random session secret (32+ characters).
5. Attach a Railway volume to the app service mounted at `/app/uploads`; the proof uploads must persist across deployments and remain private. Do not expose the volume or proof folder as a public static directory.
6. Configure the app service's pre-deploy command as `npm run db:setup` so the schema is safely created/updated before app startup. Configure its health check path as `/api/health`. Railway supplies the listening `PORT`.
7. Deploy, open the generated HTTPS domain, then configure the Paystack `charge.success` webhook as `https://YOUR-APP-DOMAIN/api/payments/paystack/webhook`. Use a live Paystack key only after confirming the live account and checkout. Test a small transaction and email before announcing the store.
8. Configure SMTP through a reputable email provider and verify sender-domain SPF/DKIM records if using a custom domain. The CEO address receives order alerts; the customer gets payment-review and delivery updates.

GitHub Pages is not suitable as the live host for this configuration: it only serves static files, while checkout, admin sign-in, MySQL, and private payment proofs require the Node.js server. A public GitHub Pages preview is available at `https://Abdullateef1000.github.io/demisvogue-store/`; its workflow publishes only the storefront pages and product images, and removes checkout/contact sections. Railway is required for the complete store; you can later connect a domain you own.

## Admin dashboard

- Open `/admin` on the running website and sign in with `ADMIN_PASSWORD`.
- Review bank/OPay transfer proofs, confirm or reject them, and update the delivery status for paid orders. Payment confirmation emails customers that the transfer was confirmed; status changes also send customer email updates.
- Proof files are served only through an authenticated admin endpoint and are not exposed as static files. Admin sessions are signed, HTTP-only, same-site cookies that expire after 8 hours; state-changing admin actions require a CSRF token.
- Use HTTPS in production so the admin session cookie is Secure. Keep `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` private and rotate them if exposed. Admin login is rate-limited.

## Payments and notifications

- Paystack checkout amounts are calculated on the server from the product prices in `index.html`, plus the NGN 2,500 delivery fee. The browser does not set the payable amount.
- Configure the Paystack webhook URL as `https://YOUR-DOMAIN/api/payments/paystack/webhook`. Subscribe to the `charge.success` event. The API validates the webhook signature and independently verifies the transaction with Paystack before setting an order to paid and emailing the CEO.
- Direct OPay/bank transfers cannot be automatically confirmed through this website without an OPay/bank integration. Customers submit a proof file; the API stores the order as pending review and emails the proof to the CEO. Do not treat a submitted receipt as proof that funds have cleared.
- Contact and complaint messages are stored and emailed to the CEO.
- Payment proof files are limited to 8 MB and stored outside the public web paths.

For production, set `NODE_ENV=production`, use HTTPS, use a hosted MySQL database with restricted network access, set `SITE_URL` to the canonical HTTPS origin, and use a dedicated SMTP service. Back up the database and the private `uploads` directory.
