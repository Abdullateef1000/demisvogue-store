const notice = document.createElement('aside');
notice.className = 'pages-preview-notice';
notice.setAttribute('role', 'status');
notice.textContent = 'Static preview only — checkout, payments, contact forms, and admin are unavailable here.';
document.body.prepend(notice);

const style = document.createElement('style');
style.textContent = `
  .pages-preview-notice {
    background: #4a1839;
    color: #fff;
    font: 600 14px/1.5 system-ui, sans-serif;
    padding: 10px 16px;
    text-align: center;
  }
`;
document.head.append(style);

document.querySelectorAll('#payment, #contact').forEach((section) => section.remove());
