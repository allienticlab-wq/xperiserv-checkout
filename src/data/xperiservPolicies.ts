export interface XperiservPolicy {
  id:
    | 'privacy-policy'
    | 'terms-and-conditions'
    | 'refund-and-cancellation'
    | 'shipping-and-delivery'
    | 'contact-information'
    | 'payment-terms'
    | 'disclaimer';
  title: string;
  shortLabel: string;
  url: string;
  version: string;
  effectiveDate: string;
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
}

export const XPERISERV_POLICY_VERSION = 'XPERISERV-POL-2026.11-V2.4';

export const XPERISERV_POLICIES: XperiservPolicy[] = [
  {
    id: 'privacy-policy',
    title: 'Privacy Policy — XperiServ Technologies & Allientic Lab Technologies',
    shortLabel: 'Privacy Policy',
    url: 'https://xperiserv.in/privacy-policy',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Governs collection, processing, and protection of personal and transaction data under India’s Digital Personal Data Protection Act, 2023 (DPDP Act).',
    sections: [
      {
        heading: '1. Information We Collect',
        body: 'We collect personal details you voluntarily provide during checkout or order tracking—specifically your full name, email address, mobile number, company/GSTIN details, and billing/shipping address—along with technical telemetry (IP address, browser user-agent, and cryptographic session tokens) required for fraud prevention and security auditing.',
      },
      {
        heading: '2. Zero Sensitive Payment Instrument Storage (PCI-DSS Compliance)',
        body: 'Allientic Checkout and XperiServ Technologies never store, log, or retain raw credit/debit card numbers (PAN), CVV/CVC security codes, UPI PINs, or net-banking passwords. All payment authorizations are processed directly through PCI-DSS certified payment partners (PayU India and Zoho Payments) using cryptographic SHA-512 and HMAC-SHA256 verification.',
      },
      {
        heading: '3. Compliance with India DPDP Act 2023 & IT Rules',
        body: 'Personal data is processed strictly for order fulfillment, GST tax invoicing, transactional notifications via Mailgun SMTP, and statutory accounting compliance under Indian law. Data is never sold or rented to third-party marketers.',
      },
      {
        heading: '4. Principal Rights & Grievance Redressal',
        body: 'Customers have the right to access, correct, update, or request erasure of personal data where not superseded by statutory tax retention mandates. Contact our Data Protection Officer at support@xperiserv.in.',
      },
    ],
  },
  {
    id: 'terms-and-conditions',
    title: 'Terms and Conditions — XperiServ Technologies',
    shortLabel: 'Terms & Conditions',
    url: 'https://xperiserv.in/terms-and-conditions',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Legally binding agreement governing the use of checkout.xperiserv.in, private purchase links, enterprise software licenses, and hardware/IoT orders.',
    sections: [
      {
        heading: '1. Binding Agreement & Scope',
        body: 'By accessing https://checkout.xperiserv.in, opening a private purchase link (/pay/{token}), or completing a payment with Allientic Lab Technologies / XperiServ Technologies, you enter into a legally binding contract governed by the laws of India, with exclusive jurisdiction in Cuttack, Odisha.',
      },
      {
        heading: '2. Private Purchase Links & Restricted Access',
        body: 'Private product purchase links (/pay/{token}) are generated exclusively for designated enterprise recipients. Links are subject to server-enforced expiration timestamps and usage limits. Unauthorized sharing, token enumeration, or automated scraping is strictly prohibited.',
      },
      {
        heading: '3. Pricing, Taxes & Server-Side Verification',
        body: 'All prices are denominated in Indian Rupees (INR) unless specified otherwise and are subject to applicable Goods and Services Tax (18% GST). Orders are marked as Paid only after cryptographic server-side verification from PayU India or Zoho Payments.',
      },
      {
        heading: '4. Intellectual Property & Deliverables',
        body: 'All software architectures, cloud configurations, API gateways, and documentation remain the proprietary intellectual property of Allientic Lab Technologies / XperiServ Technologies until full payment settlement is verified.',
      },
    ],
  },
  {
    id: 'refund-and-cancellation',
    title: 'Refund and Cancellation Policy — XperiServ Technologies',
    shortLabel: 'Refund & Cancellation Policy',
    url: 'https://xperiserv.in/cancellation-and-refund-policy',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Defines the 48-hour cancellation window and 7-business-day original-source refund settlement timeline.',
    sections: [
      {
        heading: '1. Order Cancellation Window (48 Hours)',
        body: 'Cancellation requests are accepted only if submitted within 2 days (48 hours) of placing the order or initiating the service, provided that cloud cluster provisioning, custom software deployment, or hardware dispatch has not yet commenced.',
      },
      {
        heading: '2. Refund Eligibility & Approval Workflow',
        body: 'Every refund request undergoes verification by the Allientic Finance Desk against captured payment balances. Refunds cannot exceed the net remaining captured amount of the original transaction.',
      },
      {
        heading: '3. Settlement Timeline (7 Business Days)',
        body: 'Approved full or partial refunds are initiated via the original payment gateway (PayU India or Zoho Payments) and credited back to the original payment method within 7 business days of approval, subject to issuing bank settlement cycles.',
      },
    ],
  },
  {
    id: 'shipping-and-delivery',
    title: 'Shipping and Delivery Policy — XperiServ Technologies',
    shortLabel: 'Shipping & Delivery Policy',
    url: 'https://xperiserv.in/shipping-and-delivery-policy',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Covers instant/SLA digital provisioning for enterprise cloud & software services and courier dispatch for edge hardware kits.',
    sections: [
      {
        heading: '1. Digital Software, Cloud & Audit Deliverables',
        body: 'XperiServ Technologies and Allientic Lab Technologies primarily deliver enterprise software, cloud clusters, and security audits electronically. License keys, credentials, and GST invoices are delivered via Mailgun SMTP to the registered email address within 2 to 24 hours of verified payment capture.',
      },
      {
        heading: '2. Hardware & Telemetry Edge Node Kits',
        body: 'For orders involving physical edge hardware or IoT kits, shipments are dispatched via insured enterprise courier within 3–5 business days. Shipping charges (if applicable) are itemized transparently on the checkout page prior to payment.',
      },
      {
        heading: '3. Order & Shipment Tracking',
        body: 'Customers can track real-time processing status, courier tracking numbers, and estimated delivery dates at https://checkout.xperiserv.in/track-order using their Order ID, registered email/mobile, and OTP verification.',
      },
    ],
  },
  {
    id: 'payment-terms',
    title: 'Payment Terms & Gateway Security Policy',
    shortLabel: 'Payment Terms',
    url: 'https://xperiserv.in/payment-terms',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Specifies authorized payment gateways (PayU India & Zoho Payments), GST invoicing, and cryptographic callback validation.',
    sections: [
      {
        heading: '1. Authorized Payment Gateways',
        body: 'Payments on checkout.xperiserv.in are processed exclusively via our official merchant integrations with PayU India and Zoho Payments.',
      },
      {
        heading: '2. Server-Side Cryptographic Verification',
        body: 'Browser redirects alone never constitute proof of payment. An order is confirmed as Paid only after our backend validates the PayU SHA-512 reverse hash or Zoho Payments HMAC-SHA256 webhook signature.',
      },
      {
        heading: '3. GST Tax Invoicing',
        body: 'A compliant GST Tax Invoice with HSN/SAC classification is automatically generated upon payment capture and made available for PDF download on the confirmation and order tracking pages.',
      },
    ],
  },
  {
    id: 'disclaimer',
    title: 'Legal Disclaimer — XperiServ Technologies',
    shortLabel: 'Disclaimer',
    url: 'https://xperiserv.in/disclaimer',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Service availability, third-party payment gateway dependencies, and limitation of liability.',
    sections: [
      {
        heading: '1. Service Availability & As-Is Provision',
        body: 'While Allientic Lab Technologies maintains high-availability infrastructure with automated backups and strict security controls, services and information are provided on an "as-is" basis subject to scheduled maintenance and upstream banking network availability.',
      },
      {
        heading: '2. Third-Party Banking & Issuer Delays',
        body: 'XperiServ Technologies is not liable for transaction delays, 3DS ACS timeouts, or inter-bank settlement latencies originating from customer issuing banks, NPCI UPI switches, or payment gateway maintenance windows.',
      },
    ],
  },
  {
    id: 'contact-information',
    title: 'Contact Information & Registered Office — XperiServ Technologies',
    shortLabel: 'Contact Information',
    url: 'https://xperiserv.in/contact',
    version: XPERISERV_POLICY_VERSION,
    effectiveDate: '01 November 2026',
    summary:
      'Official merchant contact details, support hours, and registered office address in Cuttack, Odisha.',
    sections: [
      {
        heading: '1. Registered Merchant & Office Address',
        body: 'XperiServ Technologies / Allientic Lab Technologies, Beside of Kathajodi River, Samsundarpur, Gopalpur, Cuttack Sadar, Odisha, India — 753011.',
      },
      {
        heading: '2. Customer & Billing Support Desk',
        body: 'Email Support: support@xperiserv.in · Billing & Checkout Escalations: checkout@mg.xperiserv.in · Primary Website: https://xperiserv.in · Checkout Portal: https://checkout.xperiserv.in',
      },
      {
        heading: '3. Operating & Office Visit Hours',
        body: 'Remote Support Hours: Monday – Friday, 9:00 AM – 6:00 PM IST · Office Visit Hours: Monday – Friday, 12:00 PM – 5:00 PM IST (Sunday Closed).',
      },
    ],
  },
];
