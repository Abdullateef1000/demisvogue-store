CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  customer_email VARCHAR(254) NOT NULL,
  product_name VARCHAR(160) NOT NULL,
  amount_ngn INT UNSIGNED NOT NULL,
  delivery_address VARCHAR(500) NOT NULL,
  payment_method ENUM('paystack', 'bank_transfer') NOT NULL,
  payment_status ENUM('pending_payment', 'pending_review', 'paid', 'failed', 'initialization_failed') NOT NULL,
  fulfillment_status ENUM('unfulfilled', 'processing', 'dispatched', 'delivered') NOT NULL DEFAULT 'unfulfilled',
  provider_reference VARCHAR(100) NULL UNIQUE,
  proof_filename VARCHAR(100) NULL,
  customer_note TEXT NULL,
  admin_notified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_email_created (customer_email, created_at),
  INDEX idx_orders_payment_status (payment_status)
);

CREATE TABLE IF NOT EXISTS customer_messages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  customer_phone VARCHAR(40) NULL,
  message TEXT NOT NULL,
  admin_notified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_email_created (customer_email, created_at)
);
