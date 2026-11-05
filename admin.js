const loginPanel = document.getElementById('login-panel');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('admin-password');
const loginMessage = document.getElementById('login-message');
const dashboardMessage = document.getElementById('dashboard-message');
const logoutButton = document.getElementById('logout-button');
const refreshButton = document.getElementById('refresh-button');
const statusFilter = document.getElementById('status-filter');
const ordersContainer = document.getElementById('orders');
const countsContainer = document.getElementById('order-counts');
let csrfToken = '';

function setMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle('success', success);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken && options.method && options.method !== 'GET') {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      showLogin();
    }
    const error = new Error(data.error || 'The request could not be completed.');
    error.saved = data.saved === true;
    throw error;
  }
  return data;
}

function showLogin() {
  csrfToken = '';
  dashboard.hidden = true;
  loginPanel.hidden = false;
  logoutButton.hidden = true;
}

function showDashboard(token) {
  csrfToken = token;
  loginPanel.hidden = true;
  dashboard.hidden = false;
  logoutButton.hidden = false;
  loadOrders();
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function makeCount(label, value) {
  const card = document.createElement('div');
  card.className = 'count-card';
  addText(card, 'span', label);
  addText(card, 'strong', String(value));
  return card;
}

function renderCounts(counts) {
  countsContainer.replaceChildren(
    makeCount('Needs transfer review', counts.pending_review || 0),
    makeCount('Paid orders', counts.paid || 0),
    makeCount('Awaiting payment', counts.pending_payment || 0),
    makeCount('Failed / rejected', counts.failed || 0)
  );
}

function addMeta(parent, label, value) {
  const item = document.createElement('div');
  item.className = 'meta-item';
  addText(item, 'span', label);
  addText(item, 'strong', value || '—');
  parent.append(item);
}

function createOrderCard(order) {
  const card = document.createElement('article');
  card.className = 'order-card';

  const heading = document.createElement('div');
  heading.className = 'order-heading';
  const identity = document.createElement('div');
  addText(identity, 'h2', order.product_name);
  addText(identity, 'p', `Order ${order.id} · ${new Date(order.created_at).toLocaleString()}`);
  heading.append(identity);
  addText(heading, 'span', order.payment_status.replaceAll('_', ' '), 'status-pill');
  card.append(heading);

  const metadata = document.createElement('div');
  metadata.className = 'order-meta';
  addMeta(metadata, 'Customer', order.customer_email);
  addMeta(metadata, 'Total', `NGN ${Number(order.amount_ngn).toLocaleString()}`);
  addMeta(metadata, 'Payment method', order.payment_method === 'bank_transfer' ? 'Bank / OPay transfer' : 'Paystack');
  addMeta(metadata, 'Fulfillment', order.fulfillment_status.replaceAll('_', ' '));
  if (order.provider_reference) addMeta(metadata, 'Paystack reference', order.provider_reference);
  card.append(metadata);

  const address = document.createElement('p');
  address.className = 'address';
  addText(address, 'strong', 'Delivery destination');
  addText(address, 'span', order.delivery_address);
  card.append(address);

  if (order.customer_note) {
    const note = document.createElement('p');
    note.className = 'customer-note';
    addText(note, 'strong', 'Customer note');
    addText(note, 'span', order.customer_note);
    card.append(note);
  }

  const actions = document.createElement('div');
  actions.className = 'order-actions';
  if (order.proof_available) {
    const proof = document.createElement('a');
    proof.className = 'proof-link';
    proof.href = `/api/admin/orders/${encodeURIComponent(order.id)}/proof`;
    proof.target = '_blank';
    proof.rel = 'noopener noreferrer';
    proof.textContent = 'View transfer proof';
    actions.append(proof);
  }

  if (order.payment_status === 'pending_review') {
    const approve = document.createElement('button');
    approve.className = 'button button-primary';
    approve.type = 'button';
    approve.textContent = 'Confirm payment';
    approve.addEventListener('click', () => updateOrder(order.id, { action: 'approve-payment' }));
    const reject = document.createElement('button');
    reject.className = 'button button-danger';
    reject.type = 'button';
    reject.textContent = 'Reject proof';
    reject.addEventListener('click', () => {
      if (window.confirm('Reject this transfer proof? The customer will be asked to contact the store.')) {
        updateOrder(order.id, { action: 'reject-payment' });
      }
    });
    actions.append(approve, reject);
  }

  if (order.payment_status === 'paid') {
    const fulfillment = document.createElement('select');
    fulfillment.setAttribute('aria-label', `Fulfillment status for order ${order.id}`);
    for (const [value, label] of [
      ['unfulfilled', 'Not started'],
      ['processing', 'Processing'],
      ['dispatched', 'Dispatched'],
      ['delivered', 'Delivered']
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      fulfillment.append(option);
    }
    fulfillment.value = order.fulfillment_status;
    const saveStatus = document.createElement('button');
    saveStatus.className = 'button button-outline';
    saveStatus.type = 'button';
    saveStatus.textContent = 'Update delivery status';
    saveStatus.addEventListener('click', () => updateOrder(order.id, { fulfillmentStatus: fulfillment.value }));
    actions.append(fulfillment, saveStatus);
  }
  card.append(actions);
  return card;
}

async function loadOrders() {
  setMessage(dashboardMessage, '');
  ordersContainer.replaceChildren();
  try {
    const data = await api(`/api/admin/orders?status=${encodeURIComponent(statusFilter.value)}`);
    renderCounts(data.counts);
    if (!data.orders.length) {
      addText(ordersContainer, 'p', 'No orders match this filter.', 'empty-state');
      return;
    }
    for (const order of data.orders) ordersContainer.append(createOrderCard(order));
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  }
}

async function updateOrder(id, changes) {
  setMessage(dashboardMessage, '');
  try {
    const data = await api(`/api/admin/orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes)
    });
    setMessage(dashboardMessage, data.message, data.notificationSent);
    await loadOrders();
  } catch (error) {
    setMessage(dashboardMessage, error.message);
    if (error.saved) await loadOrders();
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginMessage, '');
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: passwordInput.value })
    });
    passwordInput.value = '';
    showDashboard(data.csrfToken);
  } catch (error) {
    setMessage(loginMessage, error.message);
  } finally {
    submit.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  } finally {
    showLogin();
  }
});

refreshButton.addEventListener('click', loadOrders);
statusFilter.addEventListener('change', loadOrders);

api('/api/admin/session')
  .then((data) => showDashboard(data.csrfToken))
  .catch(() => showLogin());
