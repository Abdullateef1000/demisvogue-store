const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const categoryLinks = document.querySelectorAll('[data-category]');
const paymentForm = document.getElementById('payment-form');
const emailInput = document.getElementById('payment-email');
const noteInput = document.getElementById('payment-note');
const amountInput = document.getElementById('payment-amount');
const paymentStatus = document.getElementById('payment-status');
const contactForm = document.getElementById('contact-form');
const contactStatus = document.getElementById('contact-status');
const paystackButton = document.getElementById('paystack-button');
const copyTransferDetailsButton = document.getElementById('copy-transfer-details');
const paymentDeliveryAddressInput = document.getElementById('payment-delivery-address');
const summarySubtotal = document.getElementById('summary-subtotal');
const summaryTotal = document.getElementById('summary-total');

const productButtons = document.querySelectorAll('[data-product-name]');
const transferAccountName = 'Ibrahim Suliyat';
const transferAccountNumber = '8052463053';
const transferBankName = 'OPay';
const transferUssdCodes = '919, 939, 955';
const transferDetailsText = `Account Name: ${transferAccountName}\nBank: ${transferBankName}\nAccount Number: ${transferAccountNumber}\nUSSD: ${transferUssdCodes}\nReference: Product name + your email`;
const deliveryFeeNgn = 2500;

function formatNaira(amount) {
  return `₦${amount.toLocaleString('en-NG')}`;
}

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

productButtons.forEach((button) => {
  const itemPrice = Number(button.dataset.productPrice);
  const priceLabel = button.closest('.product-card')?.querySelector('.product-price');
  if (priceLabel && Number.isSafeInteger(itemPrice) && itemPrice > 0) {
    priceLabel.textContent = formatNaira(itemPrice);
  }

  button.addEventListener('click', () => {
    const itemName = button.dataset.productName;
    const productName = document.getElementById('selected-product');
    const summaryItem = document.getElementById('summary-item');

    if (productName) {
      productName.value = itemName;
    }

    if (summaryItem) {
      summaryItem.textContent = itemName;
    }

    if (amountInput) {
      amountInput.value = String(itemPrice || 0);
    }
    updateOrderSummary(itemPrice || 0);

    const paymentSection = document.getElementById('payment');
    if (paymentSection) {
      paymentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

categoryLinks.forEach((link) => {
  link.addEventListener('click', () => {
    const target = document.getElementById(link.dataset.category);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

function showStatus(element, type, message) {
  element.textContent = message;
  element.className = `status show ${type}`;
}

function updateOrderSummary(subtotal) {
  if (summarySubtotal) {
    summarySubtotal.textContent = formatNaira(subtotal);
  }
  if (summaryTotal) {
    summaryTotal.textContent = formatNaira(subtotal + deliveryFeeNgn);
  }
}

if (copyTransferDetailsButton) {
  copyTransferDetailsButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(transferDetailsText);
      showStatus(paymentStatus, 'success', 'Bank transfer details copied. Use your bank app or USSD to send the amount to the CEO account.');
    } catch (error) {
      showStatus(paymentStatus, 'warning', `Transfer details: ${transferDetailsText}`);
    }
  });
}

if (paystackButton) {
  paystackButton.addEventListener('click', async () => {
    if (!emailInput?.reportValidity() || !paymentDeliveryAddressInput?.reportValidity()) {
      return;
    }

    paystackButton.disabled = true;
    showStatus(paymentStatus, 'warning', 'Connecting to secure Paystack checkout…');
    try {
      const response = await fetch('/api/payments/paystack/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          productName: document.getElementById('selected-product')?.value.trim(),
          deliveryAddress: paymentDeliveryAddressInput.value.trim()
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Could not start Paystack checkout.');
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      showStatus(paymentStatus, 'warning', error.message || 'Could not connect to Paystack. Please try again.');
      paystackButton.disabled = false;
    }
  });
}

if (paymentForm) {
  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = paymentForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    showStatus(paymentStatus, 'warning', 'Saving your order and notifying the CEO…');
    try {
      const response = await fetch('/api/orders/manual-transfer', {
        method: 'POST',
        body: new FormData(paymentForm)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Could not submit payment proof.');
      }
      showStatus(
        paymentStatus,
        result.notificationSent ? 'success' : 'warning',
        `${result.message}${result.orderId ? ` Order ID: ${result.orderId}` : ''}`
      );
      paymentForm.reset();
    } catch (error) {
      showStatus(paymentStatus, 'warning', error.message || 'Could not submit payment proof. Please try again.');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = contactForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    showStatus(contactStatus, 'warning', 'Sending your message to the Demisvogue team…');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(contactForm).entries()))
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Could not send your message.');
      }
      showStatus(contactStatus, 'success', result.message);
      contactForm.reset();
    } catch (error) {
      showStatus(contactStatus, 'warning', error.message || 'Could not send your message. Please try again.');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

const paymentReference = new URLSearchParams(window.location.search).get('reference');
if (paymentReference && paymentStatus) {
  window.history.replaceState({}, document.title, window.location.pathname);
  showStatus(paymentStatus, 'warning', 'Checking your payment with Paystack…');
  fetch('/api/payments/paystack/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: paymentReference })
  })
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Payment verification failed.');
      showStatus(paymentStatus, result.status === 'paid' ? 'success' : 'warning', result.message);
    })
    .catch((error) => {
      showStatus(paymentStatus, 'warning', error.message || 'Payment verification could not be completed. Contact the store with your Paystack reference.');
    });
}
