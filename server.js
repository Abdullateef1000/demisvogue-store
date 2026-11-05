require('dotenv').config();

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const { loadProductCatalog } = require('./lib/catalog');
const { detectProofExtension } = require('./lib/payment-proof');
const { createAdminSession, verifyAdminSession } = require('./lib/admin-auth');

const root = __dirname;
const uploadDirectory = path.resolve(root, process.env.UPLOAD_DIR || path.join('uploads', 'private'));
const port = Number(process.env.PORT || 3000);
const deliveryFeeNgn = 2500;
const proofLimitBytes = 8 * 1024 * 1024;
const allowedProofTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf']
]);

const requiredEnvironment = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'PAYSTACK_SECRET_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'CEO_EMAIL',
  'SITE_URL',
  'ADMIN_PASSWORD',
  'ADMIN_SESSION_SECRET'
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);
if (missingEnvironment.length) {
  console.error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
  process.exit(1);
}
if (process.env.ADMIN_PASSWORD.length < 16 || process.env.ADMIN_SESSION_SECRET.length < 32) {
  console.error('ADMIN_PASSWORD must be at least 16 characters and ADMIN_SESSION_SECRET at least 32 characters.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: proofLimitBytes, files: 1 },
  fileFilter: (request, file, callback) => {
    if (!allowedProofTypes.has(file.mimetype)) {
      const error = new Error('Payment proof must be a JPEG, PNG, GIF, WebP, or PDF file.');
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  }
});

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api', apiLimiter);
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' }
});

const webhookParser = express.raw({ type: 'application/json', limit: '1mb' });
app.post('/api/payments/paystack/webhook', webhookParser, async (request, response, next) => {
  try {
    const signature = request.get('x-paystack-signature');
    if (!verifyPaystackSignature(request.body, signature)) {
      response.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }

    const event = JSON.parse(request.body.toString('utf8'));
    if (event.event !== 'charge.success' || !event.data?.reference) {
      response.sendStatus(200);
      return;
    }

    await verifyAndRecordPayment(event.data.reference);
    response.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

const publicFiles = [
  'index.html',
  'perfumes.html',
  'styles.css',
  'script.js',
  'admin.css',
  'admin.js',
  'kidscloth1.webp',
  'kidscloth2.webp',
  'kidscloth3.webp',
  'IMG-20261104-WA0029.jpg'
];
app.get('/', (request, response) => response.sendFile(path.join(root, 'index.html')));
app.get('/admin', (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.sendFile(path.join(root, 'admin.html'));
});
for (const filename of publicFiles) {
  app.get(`/${filename}`, (request, response) => response.sendFile(path.join(root, filename)));
}
app.use('/img', express.static(path.join(root, 'img'), { dotfiles: 'deny', index: false }));

app.get('/api/health', async (request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/login', adminLoginLimiter, (request, response) => {
  const password = request.body?.password;
  if (!passwordsMatch(password, process.env.ADMIN_PASSWORD)) {
    response.status(401).json({ error: 'Invalid admin password.' });
    return;
  }

  const session = createAdminSession(process.env.ADMIN_SESSION_SECRET);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `demisvogue_admin=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`
  );
  response.set('Cache-Control', 'no-store');
  response.json({ csrfToken: session.csrfToken });
});

app.get('/api/admin/session', requireAdmin, (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ csrfToken: request.adminSession.csrfToken });
});

app.post('/api/admin/logout', requireAdmin, requireAdminCsrf, (request, response) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `demisvogue_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  );
  response.sendStatus(204);
});

app.get('/api/admin/orders', requireAdmin, async (request, response, next) => {
  try {
    const filter = request.query.status || 'all';
    const allowedFilters = new Set(['all', 'pending_review', 'paid', 'pending_payment', 'failed']);
    if (!allowedFilters.has(filter)) {
      response.status(400).json({ error: 'Choose a valid order status filter.' });
      return;
    }

    const [orders] = filter === 'all'
      ? await pool.execute(
        `SELECT id, customer_email, product_name, amount_ngn, delivery_address, payment_method,
          payment_status, fulfillment_status, provider_reference, proof_filename, customer_note, created_at
         FROM orders ORDER BY created_at DESC LIMIT 200`
      )
      : await pool.execute(
        `SELECT id, customer_email, product_name, amount_ngn, delivery_address, payment_method,
          payment_status, fulfillment_status, provider_reference, proof_filename, customer_note, created_at
         FROM orders WHERE payment_status = ? ORDER BY created_at DESC LIMIT 200`,
        [filter]
      );
    const [statusRows] = await pool.execute(
      'SELECT payment_status, COUNT(*) AS total FROM orders GROUP BY payment_status'
    );
    const counts = Object.fromEntries(statusRows.map((row) => [row.payment_status, Number(row.total)]));
    response.set('Cache-Control', 'no-store');
    response.json({
      orders: orders.map(({ proof_filename: proofFilename, ...order }) => ({
        ...order,
        proof_available: Boolean(proofFilename)
      })),
      counts
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders/:id/proof', requireAdmin, async (request, response, next) => {
  try {
    const orderId = validateOrderId(request.params.id);
    const [rows] = await pool.execute(
      'SELECT proof_filename FROM orders WHERE id = ? AND payment_method = ? LIMIT 1',
      [orderId, 'bank_transfer']
    );
    const filename = rows[0]?.proof_filename;
    if (!filename || path.basename(filename) !== filename) {
      response.status(404).json({ error: 'Payment proof was not found.' });
      return;
    }
    const proofPath = path.join(uploadDirectory, filename);
    try {
      await fsp.access(proofPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.status(404).json({ error: 'Payment proof file is missing.' });
        return;
      }
      throw error;
    }
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf'
    };
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream',
      'Content-Disposition': 'inline'
    });
    response.sendFile(proofPath);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/orders/:id', requireAdmin, requireAdminCsrf, async (request, response, next) => {
  try {
    const orderId = validateOrderId(request.params.id);
    const changes = request.body;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw failValidation('Provide one valid order update.');
    }
    const keys = Object.keys(changes);
    if (keys.length !== 1 || !['action', 'fulfillmentStatus'].includes(keys[0])) {
      throw failValidation('Provide one valid order update.');
    }

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
    const order = rows[0];
    if (!order) {
      response.status(404).json({ error: 'Order was not found.' });
      return;
    }

    let updateResult;
    let customerSubject;
    let customerText;
    if (changes.action === 'approve-payment' || changes.action === 'reject-payment') {
      if (order.payment_method !== 'bank_transfer' || order.payment_status !== 'pending_review') {
        response.status(409).json({ error: 'Only a transfer proof awaiting review can be approved or rejected.' });
        return;
      }
      const approved = changes.action === 'approve-payment';
      const newStatus = approved ? 'paid' : 'failed';
      [updateResult] = await pool.execute(
        'UPDATE orders SET payment_status = ? WHERE id = ? AND payment_status = ?',
        [newStatus, orderId, 'pending_review']
      );
      customerSubject = approved ? 'Your Demisvogue payment is confirmed' : 'Action needed for your Demisvogue order';
      customerText = approved
        ? `We confirmed your transfer for order ${orderId} (${order.product_name}). Your order is now being prepared.`
        : `We could not confirm the transfer proof for order ${orderId} (${order.product_name}). Please contact the store before sending another payment.`;
    } else if (keys[0] === 'fulfillmentStatus') {
      const allowedStatuses = new Set(['unfulfilled', 'processing', 'dispatched', 'delivered']);
      const fulfillmentStatus = changes.fulfillmentStatus;
      if (!allowedStatuses.has(fulfillmentStatus)) {
        throw failValidation('Choose a valid delivery status.');
      }
      if (order.payment_status !== 'paid') {
        response.status(409).json({ error: 'Delivery status can only be changed for paid orders.' });
        return;
      }
      [updateResult] = await pool.execute(
        'UPDATE orders SET fulfillment_status = ? WHERE id = ? AND payment_status = ?',
        [fulfillmentStatus, orderId, 'paid']
      );
      const labels = {
        unfulfilled: 'not yet started',
        processing: 'being prepared',
        dispatched: 'on the way',
        delivered: 'delivered'
      };
      customerSubject = 'Your Demisvogue delivery update';
      customerText = `Your order ${orderId} (${order.product_name}) is ${labels[fulfillmentStatus]}.`;
    } else {
      throw failValidation('Choose a valid payment action.');
    }

    if (!updateResult.affectedRows) {
      response.status(409).json({ error: 'This order was updated by someone else. Refresh and try again.' });
      return;
    }

    try {
      await mailer.sendMail({
        from: process.env.MAIL_FROM,
        to: order.customer_email,
        replyTo: process.env.CEO_EMAIL,
        subject: customerSubject,
        text: `${customerText}\n\nDelivery address: ${order.delivery_address}\n\nDemisvogue`
      });
      response.json({
        saved: true,
        notificationSent: true,
        message: 'Order updated and customer notified.'
      });
    } catch (error) {
      console.error(`Order ${orderId} was updated but customer email failed: ${error.message}`);
      response.status(503).json({
        saved: true,
        notificationSent: false,
        error: 'Order updated, but the customer email could not be sent. Check SMTP and contact the customer manually.'
      });
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments/paystack/initialize', async (request, response, next) => {
  try {
    const { email, productName, deliveryAddress } = validateOrderInput(request.body);
    const amountNgn = priceFor(productName) + deliveryFeeNgn;
    const orderId = crypto.randomUUID();
    const reference = `demisvogue_${orderId.replaceAll('-', '')}`;
    const callbackUrl = new URL('/', process.env.SITE_URL);
    callbackUrl.searchParams.set('reference', reference);

    await pool.execute(
      `INSERT INTO orders
        (id, customer_email, product_name, amount_ngn, delivery_address, payment_method, payment_status, provider_reference)
       VALUES (?, ?, ?, ?, ?, 'paystack', 'pending_payment', ?)`,
      [orderId, email, productName, amountNgn, deliveryAddress, reference]
    );

    try {
      const gatewayResponse = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          amount: amountNgn * 100,
          currency: 'NGN',
          reference,
          callback_url: callbackUrl.toString(),
          metadata: { order_id: orderId, product_name: productName }
        }),
        signal: AbortSignal.timeout(15000)
      });
      const gatewayData = await gatewayResponse.json();
      if (!gatewayResponse.ok || !gatewayData.status || !gatewayData.data?.authorization_url) {
        throw new Error(gatewayData.message || 'Paystack could not initialize the transaction.');
      }

      response.json({ authorizationUrl: gatewayData.data.authorization_url, reference });
    } catch (error) {
      await pool.execute(
        'UPDATE orders SET payment_status = ? WHERE id = ?',
        ['initialization_failed', orderId]
      );
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments/paystack/verify', async (request, response, next) => {
  try {
    const reference = validateReference(request.body?.reference);
    const result = await verifyAndRecordPayment(reference);
    response.json({ status: result.status, message: result.message });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/manual-transfer', upload.single('proof'), async (request, response, next) => {
  let uploadedPath = request.file?.path;
  try {
    const { email, productName, deliveryAddress, note } = validateOrderInput(request.body);
    if (!request.file) {
      response.status(400).json({ error: 'A payment proof file is required.' });
      return;
    }

    const fileBuffer = await fsp.readFile(request.file.path);
    const extension = detectProofExtension(fileBuffer);
    if (!extension || extension !== allowedProofTypes.get(request.file.mimetype)) {
      await fsp.unlink(request.file.path);
      uploadedPath = null;
      response.status(400).json({ error: 'The payment proof file type could not be verified.' });
      return;
    }

    const storedFilename = `${crypto.randomUUID()}${extension}`;
    const storedPath = path.join(uploadDirectory, storedFilename);
    await fsp.rename(request.file.path, storedPath);
    uploadedPath = storedPath;

    const orderId = crypto.randomUUID();
    const amountNgn = priceFor(productName) + deliveryFeeNgn;
    await pool.execute(
      `INSERT INTO orders
        (id, customer_email, product_name, amount_ngn, delivery_address, payment_method, payment_status, proof_filename, customer_note)
       VALUES (?, ?, ?, ?, ?, 'bank_transfer', 'pending_review', ?, ?)`,
      [orderId, email, productName, amountNgn, deliveryAddress, storedFilename, note || null]
    );

    const notification = await sendOrderNotification({
      orderId,
      email,
      productName,
      amountNgn,
      deliveryAddress,
      method: 'Bank / OPay transfer - proof submitted, not yet verified',
      proofPath: storedPath,
      note
    });
    if (notification.sent) {
      await pool.execute('UPDATE orders SET admin_notified_at = CURRENT_TIMESTAMP WHERE id = ?', [orderId]);
    }

    response.status(201).json({
      orderId,
      paymentStatus: 'pending_review',
      notificationSent: notification.sent,
      message: notification.sent
        ? 'Payment proof was saved and emailed to the CEO for review. The transfer is not confirmed until it is checked.'
        : 'Payment proof was saved, but the CEO email could not be sent. Please contact the store and quote this order ID.'
    });
  } catch (error) {
    if (uploadedPath) {
      await fsp.unlink(uploadedPath).catch((cleanupError) => {
        console.error(`Could not remove temporary payment proof: ${cleanupError.message}`);
      });
    }
    next(error);
  }
});

app.post('/api/contact', async (request, response, next) => {
  try {
    const name = requiredText(request.body?.name, 'Name', 120);
    const email = validateEmail(request.body?.email);
    const phone = optionalText(request.body?.phone, 40);
    const message = requiredText(request.body?.message, 'Message', 5000);
    const id = crypto.randomUUID();

    await pool.execute(
      `INSERT INTO customer_messages (id, customer_name, customer_email, customer_phone, message)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, email, phone || null, message]
    );

    try {
      await mailer.sendMail({
        from: process.env.MAIL_FROM,
        to: process.env.CEO_EMAIL,
        replyTo: email,
        subject: `Demisvogue customer message (${id})`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\n\nMessage:\n${message}`
      });
      await pool.execute('UPDATE customer_messages SET admin_notified_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    } catch (error) {
      console.error(`Customer message ${id} was saved but email notification failed: ${error.message}`);
      response.status(503).json({
        id,
        saved: true,
        error: 'Your message was saved, but email notification failed. Please try again or contact the store.'
      });
      return;
    }

    response.status(201).json({ id, message: 'Your message was sent to the Demisvogue team.' });
  } catch (error) {
    next(error);
  }
});

app.use((request, response) => {
  response.status(404).json({ error: 'Not found.' });
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    response.status(status).json({
      error: status === 413 ? 'Payment proof must be 8 MB or smaller.' : error.message
    });
    return;
  }

  if (error.status && error.status < 500) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: error.publicMessage || 'The server could not complete the request.' });
});

const products = loadProductCatalog(path.join(root, 'index.html'));

function passwordsMatch(provided, configured) {
  if (typeof provided !== 'string' || provided.length > 1024) {
    return false;
  }
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const configuredDigest = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(providedDigest, configuredDigest);
}

function readAdminSession(request) {
  const cookie = request.headers.cookie || '';
  const token = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('demisvogue_admin='))
    ?.slice('demisvogue_admin='.length);
  return verifyAdminSession(token, process.env.ADMIN_SESSION_SECRET);
}

function requireAdmin(request, response, next) {
  const session = readAdminSession(request);
  if (!session) {
    response.status(401).json({ error: 'Admin sign-in is required.' });
    return;
  }
  request.adminSession = session;
  next();
}

function requireAdminCsrf(request, response, next) {
  const provided = request.get('x-csrf-token') || '';
  const expectedDigest = crypto.createHash('sha256').update(request.adminSession.csrfToken).digest();
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  if (!provided || !crypto.timingSafeEqual(providedDigest, expectedDigest)) {
    response.status(403).json({ error: 'Admin session verification failed. Refresh the dashboard and try again.' });
    return;
  }
  next();
}

function validateOrderId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) {
    throw failValidation('Invalid order ID.');
  }
  return value;
}

function failValidation(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw failValidation(`${label} is required.`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw failValidation(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return text;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw failValidation(`Optional text must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function validateEmail(value) {
  const email = requiredText(value, 'Email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw failValidation('Enter a valid email address.');
  }
  return email;
}

function validateOrderInput(body) {
  const email = validateEmail(body?.email);
  const productName = requiredText(body?.productName, 'Product', 160);
  if (!products.has(productName)) {
    throw failValidation('Choose a valid product from the catalog.');
  }
  const deliveryAddress = requiredText(body?.deliveryAddress, 'Delivery address', 500);
  const note = optionalText(body?.note, 2000);
  return { email, productName, deliveryAddress, note };
}

function priceFor(productName) {
  return products.get(productName);
}

function validateReference(value) {
  const reference = requiredText(value, 'Payment reference', 100);
  if (!/^demisvogue_[a-f0-9-]+$/i.test(reference)) {
    throw failValidation('Invalid payment reference.');
  }
  return reference;
}

function verifyPaystackSignature(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') {
    return false;
  }
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function verifyAndRecordPayment(reference) {
  const [rows] = await pool.execute(
    'SELECT * FROM orders WHERE provider_reference = ? AND payment_method = ? LIMIT 1',
    [reference, 'paystack']
  );
  const order = rows[0];
  if (!order) {
    throw failValidation('Payment order was not found.');
  }

  const gatewayResponse = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      signal: AbortSignal.timeout(15000)
    }
  );
  const gatewayData = await gatewayResponse.json();
  if (!gatewayResponse.ok || !gatewayData.status) {
    throw new Error(gatewayData.message || 'Could not verify the payment with Paystack.');
  }

  const transaction = gatewayData.data;
  if (transaction.status !== 'success') {
    return { status: transaction.status || 'pending', message: 'Payment has not been confirmed by Paystack yet.' };
  }
  if (
    transaction.reference !== order.provider_reference
    || transaction.currency !== 'NGN'
    || Number(transaction.amount) !== order.amount_ngn * 100
    || transaction.customer?.email?.toLowerCase() !== order.customer_email.toLowerCase()
  ) {
    throw new Error(`Paystack verification data did not match order ${order.id}.`);
  }

  const connection = await pool.getConnection();
  let shouldNotify = false;
  try {
    await connection.beginTransaction();
    const [lockedRows] = await connection.execute(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [order.id]
    );
    const lockedOrder = lockedRows[0];
    if (!lockedOrder) {
      throw new Error(`Payment order ${order.id} disappeared during verification.`);
    }
    if (lockedOrder.payment_status !== 'paid') {
      await connection.execute(
        'UPDATE orders SET payment_status = ? WHERE id = ?',
        ['paid', lockedOrder.id]
      );
    }
    shouldNotify = !lockedOrder.admin_notified_at;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (shouldNotify) {
    await sendOrderNotification({
      orderId: order.id,
      email: order.customer_email,
      productName: order.product_name,
      amountNgn: order.amount_ngn,
      deliveryAddress: order.delivery_address,
      method: 'Paystack (verified)',
      reference
    });
    await pool.execute('UPDATE orders SET admin_notified_at = CURRENT_TIMESTAMP WHERE id = ?', [order.id]);
  }

  return { status: 'paid', message: 'Paystack confirmed your payment. The CEO has been notified.' };
}

async function sendOrderNotification({ orderId, email, productName, amountNgn, deliveryAddress, method, reference, proofPath, note }) {
  const text = [
    `Order ID: ${orderId}`,
    `Payment status: ${method.includes('verified') ? 'PAID - verified by Paystack' : 'PENDING MANUAL REVIEW'}`,
    `Payment method: ${method}`,
    reference ? `Paystack reference: ${reference}` : '',
    `Customer email: ${email}`,
    `Product: ${productName}`,
    `Amount including delivery: NGN ${amountNgn}`,
    `Delivery address: ${deliveryAddress}`,
    note ? `Customer note: ${note}` : ''
  ].filter(Boolean).join('\n');

  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.CEO_EMAIL,
      replyTo: email,
      subject: `${method.includes('verified') ? 'Payment received' : 'Payment proof submitted'} - ${productName}`,
      text,
      attachments: proofPath ? [{ filename: path.basename(proofPath), path: proofPath }] : []
    });
    return { sent: true };
  } catch (error) {
    console.error(`Order ${orderId} notification failed: ${error.message}`);
    if (method.includes('verified')) {
      throw error;
    }
    return { sent: false };
  }
}

async function start() {
  await fsp.mkdir(uploadDirectory, { recursive: true });
  await pool.query('SELECT 1');
  await mailer.verify();
  const server = app.listen(port, () => {
    console.log(`Demisvogue API is listening at ${process.env.SITE_URL}`);
    console.log(`Loaded ${products.size} products from index.html.`);
  });

  const shutdown = () => {
    server.close(() => {
      pool.end().then(() => process.exit(0)).catch((error) => {
        console.error(`Database shutdown failed: ${error.message}`);
        process.exit(1);
      });
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error(`Server startup failed: ${error.message}`);
  process.exit(1);
});
