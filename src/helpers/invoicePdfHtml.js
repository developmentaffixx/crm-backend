/**
 * Generates the invoice HTML that exactly matches the new UI design.
 * Used for PDF generation (download & email attachment).
 */

function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);
  let result = 'Rs. ' + convert(intPart);
  if (decPart > 0) result += ' and ' + convert(decPart) + ' Paise';
  return result + ' Only';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatINR(num) {
  return Number(num).toLocaleString('en-IN');
}

/**
 * @param {Object} invoice - Invoice object with items, lead_*, bank details
 * @param {Object} comp - Company settings object
 * @param {Array} items - Invoice items array
 * @param {string|null} logoBase64 - Base64 encoded logo (data:image/png;base64,...)
 * @returns {string} Full HTML string matching the new UI
 */
function buildInvoiceHtml(invoice, comp, items, logoBase64) {
  const billDate = formatDate(invoice.bill_date);
  const dueDate = formatDate(invoice.due_date);
  const companyAddr = [comp.address_line1, comp.city, comp.state, comp.zip_code].filter(Boolean).join(', ');
  const companyContact = [comp.phone, comp.email].filter(Boolean).join('  |  ');
  const clientAddr = [invoice.lead_address, invoice.lead_city, invoice.lead_state, invoice.lead_zip].filter(Boolean).join(', ');
  const amountWords = numberToWords(parseFloat(invoice.total_amount || 0));

  // Items rows
  const itemsHtml = items.map((item) => `
    <tr style="border-bottom:1px solid #e8e2dc;">
      <td style="padding:10px 8px;font-size:13px;color:#4a4340;text-align:left;">
        ${item.service_name || item.description || '—'}
        ${item.service_name && item.description ? `<div style="font-size:11px;color:#9a8e82;margin-top:2px;">${item.description}</div>` : ''}
      </td>
      <td style="padding:10px 8px;text-align:center;font-size:13px;color:#6b5e50;">${item.hsn_code || '—'}</td>
      <td style="padding:10px 8px;text-align:center;font-size:13px;color:#6b5e50;">${Number(item.quantity)}</td>
      <td style="padding:10px 8px;text-align:right;font-size:13px;color:#6b5e50;">₹${formatINR(item.rate)}</td>
      <td style="padding:10px 8px;text-align:right;font-size:13px;font-weight:600;color:#4a4340;">₹${formatINR(item.amount)}</td>
    </tr>
  `).join('');

  // Discount row in totals
  const discountHtml = parseFloat(invoice.discount) > 0 ? `
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#6b5e50;border-bottom:1px solid #e8e2dc;">
      <span>Discount</span>
      <span>- ₹${formatINR(invoice.discount)}</span>
    </div>` : '';

  // Status watermark removed for consistent design across all views
  let statusStamp = '';

  // Logo
  const logoHtml = logoBase64
    ? `<div style="text-align:center;margin-bottom:8px;"><img src="${logoBase64}" style="height:56px;object-fit:contain;" /></div>`
    : '';

  // Terms
  const termsHtml = invoice.note
    ? `<p style="font-size:11px;white-space:pre-line;line-height:1.6;color:#9a8e82;margin:0;">${invoice.note}</p>`
    : `<div style="font-size:11px;color:#9a8e82;line-height:1.8;">
        <p style="margin:0;">• All payments made are non-refundable.</p>
        <p style="margin:0;">• Additional works will be charged separately.</p>
        <p style="margin:0;">• Delayed payments may affect project timelines.</p>
        <p style="margin:0;">• Client approvals are required before final delivery.</p>
      </div>`;

  // Bank details
  const bankHtml = (invoice.bank_name || invoice.account_number) ? `
    <div>
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#b8a994;margin-bottom:8px;">Bank Details</p>
      <div style="font-size:11px;color:#6b5e50;line-height:1.8;">
        ${invoice.bank_name ? `<p style="margin:0;">Bank name: <strong>${invoice.bank_name}</strong></p>` : ''}
        ${invoice.account_number ? `<p style="margin:0;">Account No: <strong>${invoice.account_number}</strong></p>` : ''}
        ${invoice.ifsc_code ? `<p style="margin:0;">IFSC: <strong>${invoice.ifsc_code}</strong></p>` : ''}
        ${invoice.branch ? `<p style="margin:0;">Branch: ${invoice.branch}</p>` : ''}
        ${(invoice.upi_id || comp.upi_id) ? `<p style="margin:0;">UPI: <strong>${invoice.upi_id || comp.upi_id}</strong></p>` : ''}
      </div>
    </div>` : '';

  // QR code
  const qrHtml = (invoice.qr_code_url || comp.upi_qr_url) ? `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#b8a994;margin-bottom:8px;">Scan & Pay</p>
      <img src="${invoice.qr_code_url || comp.upi_qr_url}" style="width:52px;height:52px;object-fit:cover;border:1.5px solid #b8a994;padding:2px;border-radius:3px;" />
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${invoice.invoice_number}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Times New Roman',Times,serif;font-size:13px;color:#4a4340;background:#fff;margin:0;padding:0;}
  .page{position:relative;width:210mm;min-height:297mm;padding:60px 50px 40px 70px;overflow:hidden;background:#fff;}
  /* Arch background */
  .arch-bg{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:95%;height:97%;border-top-left-radius:45%;border-top-right-radius:45%;background:#f5f1eb;pointer-events:none;z-index:0;}
  .content{position:relative;z-index:1;}
  /* Status stamp */
  .status-stamp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-20deg);font-size:48px;font-weight:900;text-transform:uppercase;letter-spacing:4px;padding:10px 24px;border:4px solid;border-radius:12px;opacity:0.08;pointer-events:none;white-space:nowrap;z-index:10;}
  /* Items table */
  table.items{width:100%;border-collapse:collapse;margin-bottom:16px;}
  table.items th{padding:10px 8px;text-align:left;font-size:12px;font-weight:700;color:#4a4340;border-bottom:1.5px solid #b8a994;}
  table.items th.c{text-align:center;}
  table.items th.r{text-align:right;}
  table.items td{padding:10px 8px;font-size:13px;color:#4a4340;}
  /* Footer grid */
  .footer-grid{display:flex;border-top:1px solid #e0d9d0;margin-top:24px;padding-top:20px;}
  .footer-col{flex:1;padding:0 16px;}
  .footer-col:first-child{padding-left:0;}
  .footer-col:last-child{padding-right:0;}
  .footer-col:not(:last-child){border-right:1px solid #e0d9d0;}
  @media print{
    body{background:#fff;}
    .page{box-shadow:none;margin:0;padding:50px 40px 30px 60px;}
  }
</style>
</head>
<body>
<div class="page">
  <div class="arch-bg"></div>
  ${statusStamp}
  <div class="content">

    <!-- Logo -->
    ${logoHtml}

    <!-- INVOICE Title -->
    <div style="text-align:center;margin-bottom:16px;">
      <h1 style="font-size:22px;font-weight:300;letter-spacing:6px;text-transform:uppercase;color:#6b5e50;margin:0;">Invoice</h1>
    </div>

    <!-- Company Info -->
    <div style="text-align:center;margin-bottom:24px;">
      <p style="font-size:14px;font-weight:600;color:#4a4340;margin:0;">${comp.company_name || 'Your Business'}</p>
      <div style="font-size:12px;color:#9a8e82;font-weight:400;margin-top:4px;line-height:1.6;">
        ${companyContact ? `<p style="margin:0;">${companyContact}</p>` : ''}
        ${companyAddr ? `<p style="margin:0;">${companyAddr}</p>` : ''}
      </div>
      ${comp.gstin ? `<p style="font-size:12px;font-weight:600;color:#4a4340;margin-top:4px;">GSTIN: ${comp.gstin}</p>` : ''}
    </div>

    <!-- Issued To + Invoice Meta -->
    <div style="display:flex;margin-bottom:24px;">
      <!-- Left: Issued To -->
      <div style="flex:1;padding-right:16px;border-right:1px solid #e0d9d0;">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;color:#b8a994;margin-bottom:8px;">Issued To:</p>
        <p style="font-size:14px;font-weight:600;color:#4a4340;margin:0;">${invoice.lead_business || '—'}</p>
        <div style="font-size:12px;color:#6b5e50;margin-top:4px;line-height:1.6;">
          ${invoice.lead_name ? `<p style="margin:0;">${invoice.lead_name}</p>` : ''}
          ${invoice.lead_phone ? `<p style="margin:0;">${invoice.lead_phone}</p>` : ''}
          ${invoice.lead_email ? `<p style="margin:0;">${invoice.lead_email}</p>` : ''}
          ${clientAddr ? `<p style="margin:0;">${clientAddr}</p>` : ''}
        </div>
      </div>
      <!-- Right: Invoice details -->
      <div style="flex:1;padding-left:16px;">
        <table style="font-size:13px;color:#6b5e50;">
          <tr>
            <td style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding-right:12px;padding:2px 12px 2px 0;">Invoice Nr:</td>
            <td style="font-weight:700;padding:2px 0;">${invoice.invoice_number}</td>
          </tr>
          <tr>
            <td style="font-size:11px;padding-right:12px;padding:2px 12px 2px 0;">Date:</td>
            <td style="padding:2px 0;">${billDate}</td>
          </tr>
          <tr>
            <td style="font-size:11px;padding-right:12px;padding:2px 12px 2px 0;">Due date:</td>
            <td style="padding:2px 0;">${dueDate}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Items Table -->
    <table class="items">
      <thead>
        <tr>
          <th style="width:40%;text-align:left;">Description</th>
          <th class="c" style="width:12%;">HSN</th>
          <th class="c" style="width:10%;">Qty</th>
          <th class="r" style="width:18%;text-align:right;">Price</th>
          <th class="r" style="width:20%;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
      <div style="width:220px;">
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#6b5e50;border-bottom:1px solid #e8e2dc;">
          <span style="font-weight:600;">Sub-total</span>
          <span>₹${formatINR(invoice.subtotal)}</span>
        </div>
        ${discountHtml}
        <div style="display:flex;justify-content:space-between;padding:8px 10px;font-size:14px;font-weight:700;color:#4a4340;background:#f7f3ee;border-radius:4px;margin-top:4px;">
          <span>Total</span>
          <span>₹${formatINR(invoice.total_amount)}</span>
        </div>
        ${parseFloat(invoice.paid_amount) > 0 ? `
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#16a34a;border-bottom:1px solid #e8e2dc;margin-top:4px;">
          <span style="font-weight:600;">Paid Amount</span>
          <span>₹${formatINR(invoice.paid_amount)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700;color:#dc2626;margin-top:2px;">
          <span>Balance Due</span>
          <span>₹${formatINR(invoice.balance_amount)}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Amount in Words -->
    <p style="font-size:12px;font-style:italic;color:#9a8e82;margin-bottom:8px;">${amountWords}</p>

    <!-- Footer: Terms | Bank/QR | Signature -->
    <div class="footer-grid">
      <!-- Terms -->
      <div class="footer-col">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#b8a994;margin-bottom:8px;">Terms & Conditions</p>
        ${termsHtml}
      </div>
      <!-- Bank + QR -->
      <div class="footer-col" style="display:flex;flex-direction:column;gap:12px;">
        ${bankHtml}
        ${qrHtml}
      </div>
      <!-- Signature -->
      <div class="footer-col" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-height:120px;">
        <div style="border-top:1px solid #b8a994;padding-top:5px;text-align:center;width:80%;">
          <p style="font-size:11px;color:#9a8e82;">For Affixx Media</p>
        </div>
      </div>
    </div>

    <!-- Page Footer -->
    <div style="text-align:center;margin-top:16px;padding-top:8px;">
      <p style="font-size:11px;font-weight:500;color:#b8a994;">Entity belongs to Scale Forge Private Limited</p>
    </div>

  </div><!-- end content -->
</div><!-- end page -->
</body>
</html>`;
}

module.exports = { buildInvoiceHtml };
