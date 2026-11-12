import React, { useState } from 'react';
import { X, Plus, Trash2, Printer, ShieldCheck } from 'lucide-react';

export const CreateOrderModal: React.FC<{
  products: any[];
  onClose: () => void;
  onCreated: (checkoutSessionToken?: string) => Promise<void>;
  authToken: string | null;
}> = ({ products, onClose, onCreated, authToken }) => {
  const [customerName, setCustomerName] = useState('Karan Malhotra');
  const [customerEmail, setCustomerEmail] = useState('karan.malhotra@nexustech.in');
  const [customerMobile, setCustomerMobile] = useState('+91 98112 34091');
  const [companyName, setCompanyName] = useState('Nexus Enterprise Systems Pvt Ltd');
  const [gstin, setGstin] = useState('29AABCN7721E1Z1');
  const [customReference, setCustomReference] = useState(
    `PO-NEXUS-${Math.floor(100 + Math.random() * 899)}`
  );
  const [couponCode, setCouponCode] = useState('');
  const [selectedGateway, setSelectedGateway] = useState<'PAYU' | 'ZOHO_PAYMENTS'>('PAYU');
  const [selectedItems, setSelectedItems] = useState<
    Array<{
      productId?: number;
      sku: string;
      name: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      taxRatePercent: number;
    }>
  >(() => {
    if (products.length > 0) {
      return [
        {
          productId: products[0].id,
          sku: products[0].sku,
          name: products[0].name,
          description: products[0].description,
          quantity: 1,
          unitPricePaise: products[0].unitPricePaise,
          taxRatePercent: products[0].taxRatePercent || 18,
        },
      ];
    }
    return [
      {
        sku: 'ALT-CLD-ENT-01',
        name: 'Allientic Cloud Enterprise Cluster',
        description: 'Dedicated high-availability infrastructure',
        quantity: 1,
        unitPricePaise: 4500000,
        taxRatePercent: 18,
      },
    ];
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddProductRow = () => {
    const p = products[0];
    setSelectedItems((prev) => [
      ...prev,
      {
        productId: p?.id,
        sku: p?.sku || 'ALT-CUSTOM-01',
        name: p?.name || 'Custom Enterprise Service',
        description: p?.description || 'Professional deployment service',
        quantity: 1,
        unitPricePaise: p?.unitPricePaise || 1500000,
        taxRatePercent: p?.taxRatePercent || 18,
      },
    ]);
  };

  const subtotalPaise = selectedItems.reduce(
    (sum, i) => sum + i.unitPricePaise * i.quantity,
    0
  );
  const taxPaise = selectedItems.reduce(
    (sum, i) => sum + Math.round((i.unitPricePaise * i.quantity * i.taxRatePercent) / 100),
    0
  );
  const totalPaise = subtotalPaise + taxPaise;

  const handleSubmit = async (e: React.FormEvent, openCheckoutAfter: boolean) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch('/api/v1/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customerName,
          customerEmail,
          customerMobile,
          companyName,
          gstin,
          customReference,
          couponCode: couponCode.trim() || undefined,
          selectedGateway,
          items: selectedItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create order');
      } else {
        await onCreated(openCheckoutAfter ? data.checkoutSession?.sessionToken : undefined);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              Create Order &amp; Hosted Checkout Session
            </h2>
            <p className="text-xs text-slate-400">
              Generates an immutable order record and unique checkout link on checkout.xperiserv.in
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="bg-rose-950/50 border border-rose-800 text-rose-200 text-xs p-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Customer Full Name *</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Customer Email *</label>
              <input
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Mobile Number *</label>
              <input
                type="text"
                required
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Company / Organization</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Custom PO / Reference</label>
              <input
                type="text"
                value={customReference}
                onChange={(e) => setCustomReference(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Preferred Payment Gateway</label>
              <select
                value={selectedGateway}
                onChange={(e) => setSelectedGateway(e.target.value as 'PAYU' | 'ZOHO_PAYMENTS')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value="PAYU">PayU India (UPI, Cards, NetBanking, Wallets)</option>
                <option value="ZOHO_PAYMENTS">Zoho Payments (UPI, Cards, NetBanking)</option>
              </select>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Order Line Items</label>
              <button
                type="button"
                onClick={handleAddProductRow}
                className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </button>
            </div>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {selectedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs"
                >
                  <div className="col-span-6">
                    <select
                      value={item.sku}
                      onChange={(e) => {
                        const found = products.find((p) => p.sku === e.target.value);
                        if (found) {
                          setSelectedItems((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? {
                                    productId: found.id,
                                    sku: found.sku,
                                    name: found.name,
                                    description: found.description,
                                    quantity: row.quantity,
                                    unitPricePaise: found.unitPricePaise,
                                    taxRatePercent: found.taxRatePercent || 18,
                                  }
                                : row
                            )
                          );
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-slate-100"
                    >
                      {products.map((p) => (
                        <option key={p.sku} value={p.sku}>
                          {p.name} (₹{(p.unitPricePaise / 100).toLocaleString('en-IN')})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        setSelectedItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? { ...row, quantity: Math.max(1, Number(e.target.value)) }
                              : row
                          )
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 font-mono text-center text-slate-100"
                    />
                  </div>
                  <div className="col-span-3 text-right font-mono tabular-nums text-slate-200">
                    ₹{((item.unitPricePaise * item.quantity) / 100).toLocaleString('en-IN')}
                  </div>
                  <div className="col-span-1 text-right">
                    {selectedItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-2 border-t border-slate-800 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Optional Coupon Code</label>
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="ALLIENTIC10 or XPERISERV2500"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1 text-right">
              <div className="text-slate-400">
                Subtotal: <span className="font-mono text-slate-200">₹{(subtotalPaise / 100).toLocaleString('en-IN')}</span> · GST (18%):{' '}
                <span className="font-mono text-slate-200">₹{(taxPaise / 100).toLocaleString('en-IN')}</span>
              </div>
              <div className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
                Estimated Total: ₹{(totalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Order Only'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={(e) => handleSubmit(e, true)}
              className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
            >
              {submitting ? 'Launching...' : 'Create & Open Customer Checkout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const RefundModal: React.FC<{
  payment: any;
  onClose: () => void;
  onRefunded: () => Promise<void>;
  authToken: string | null;
}> = ({ payment, onClose, onRefunded, authToken }) => {
  const remainingPaise = payment.amountPaise - payment.refundedAmountPaise;
  const [amountRupees, setAmountRupees] = useState<string>(
    (remainingPaise / 100).toFixed(2)
  );
  const [reason, setReason] = useState<string>('Customer requested partial service adjustment');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const amountPaise = Math.round(Number(amountRupees) * 100);
    if (isNaN(amountPaise) || amountPaise <= 0 || amountPaise > remainingPaise) {
      setError(
        `Refund amount cannot exceed remaining refundable balance of ₹${(
          remainingPaise / 100
        ).toFixed(2)}`
      );
      setSubmitting(false);
      return;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch(`/api/v1/payments/${payment.id}/refunds`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amountPaise, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Refund initiation failed');
      } else {
        await onRefunded();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-white">Initiate Gateway Refund</h3>
            <p className="text-xs text-slate-400 font-mono">
              {payment.transactionId} · {payment.gatewayCode}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Captured Amount:</span>
            <span className="font-mono text-slate-200">
              ₹{(payment.amountPaise / 100).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Already Refunded:</span>
            <span className="font-mono text-amber-400">
              ₹{(payment.refundedAmountPaise / 100).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between font-semibold border-t border-slate-800 pt-1">
            <span className="text-slate-200">Remaining Refundable Balance:</span>
            <span className="font-mono text-emerald-400">
              ₹{(remainingPaise / 100).toFixed(2)}
            </span>
          </div>
        </div>

        {error && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 text-xs p-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 mb-1">Refund Amount (INR) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1">Refund Reason &amp; Audit Note *</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-slate-800 text-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg"
            >
              {submitting ? 'Dispatching to Gateway...' : 'Approve & Execute Refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const InvoicePreviewModal: React.FC<{
  order: any;
  onClose: () => void;
}> = ({ order, onClose }) => {
  const items = (() => {
    try {
      return JSON.parse(order.itemsJson || '[]');
    } catch {
      return [];
    }
  })();

  const billingMeta = (() => {
    try {
      const parsed = JSON.parse(order.billingAddress || '{}');
      return parsed && typeof parsed === 'object' ? parsed : { line1: order.billingAddress || '' };
    } catch {
      return { line1: order.billingAddress || '' };
    }
  })();

  const formatINR = (paise: number) =>
    `₹${((paise || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="text-xs text-emerald-400 font-semibold flex items-center gap-2">
              <span>Allientic Lab Technologies · GST Tax Invoice</span>
              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-300">
                {order.isPrivateLinkOrder ? 'Private Link Order' : 'Public Storefront Order'}
              </span>
            </div>
            <h3 className="text-lg font-bold text-white font-mono">
              {order.invoiceNumber || `INV-${order.orderNumber}`}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Download PDF
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 text-xs">
          <div>
            <div className="text-slate-500 mb-1">Issued By (Merchant)</div>
            <div className="font-semibold text-white">Allientic Lab Technologies Pvt. Ltd.</div>
            <div className="text-slate-400">https://checkout.xperiserv.in</div>
            <div className="text-emerald-400 font-mono font-semibold mt-0.5">
              Merchant GSTIN: {billingMeta.merchantGstin || '29AABCA8921K1Z5'}
            </div>
            <div className="text-slate-500 font-mono text-[11px]">
              State Code: 29 (Karnataka) · SAC: 998314
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-500 mb-1">Billed To (Customer)</div>
            <div className="font-semibold text-white">{order.customerName}</div>
            {billingMeta.companyName && (
              <div className="text-slate-200 font-medium">{billingMeta.companyName}</div>
            )}
            <div className="text-slate-400">{order.customerEmail}</div>
            <div className="text-slate-400 font-mono">{order.customerMobile}</div>
            {billingMeta.gstin ? (
              <div className="text-emerald-400 font-mono font-semibold mt-0.5">
                Customer GSTIN: {billingMeta.gstin}
              </div>
            ) : (
              <div className="text-slate-500 font-mono text-[11px] mt-0.5">
                Customer GSTIN: Unregistered / B2C Consumer
              </div>
            )}
            {billingMeta.detectedCountry && (
              <div className="text-slate-500 font-mono text-[10px]">
                IP: {billingMeta.detectedIp || 'Verified'} · {billingMeta.detectedCountry}{' '}
                {billingMeta.displayCurrency ? `(${billingMeta.displayCurrency})` : ''}
              </div>
            )}
          </div>
        </div>

        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2">Description &amp; SKU</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit Price</th>
              <th className="py-2 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {items.map((item: any, idx: number) => (
              <tr key={idx}>
                <td className="py-2.5">
                  <div className="font-medium text-slate-100">{item.name}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    SKU: {item.sku} · GST: {item.taxRatePercent ?? 18}%
                  </div>
                </td>
                <td className="py-2.5 text-right font-mono">{item.quantity}</td>
                <td className="py-2.5 text-right font-mono">{formatINR(item.unitPricePaise)}</td>
                <td className="py-2.5 text-right font-mono text-slate-100">
                  {formatINR(item.unitPricePaise * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-slate-800 pt-4 space-y-1.5 text-xs max-w-xs ml-auto">
          <div className="flex justify-between text-slate-400">
            <span>Taxable Subtotal</span>
            <span className="font-mono text-slate-200">{formatINR(order.subtotalPaise)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>IGST / CGST+SGST</span>
            <span className="font-mono text-slate-200">{formatINR(order.taxAmountPaise)}</span>
          </div>
          {order.shippingChargesPaise > 0 && (
            <div className="flex justify-between text-slate-400">
              <span>Shipping &amp; Handling</span>
              <span className="font-mono text-slate-200">
                {formatINR(order.shippingChargesPaise)}
              </span>
            </div>
          )}
          {order.discountAmountPaise > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Discount ({order.couponCode || 'Promo'})</span>
              <span className="font-mono">-{formatINR(order.discountAmountPaise)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-white border-t border-slate-800 pt-2">
            <span>Invoice Total</span>
            <span className="font-mono text-emerald-400">{formatINR(order.totalAmountPaise)}</span>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-800 pt-3">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Digitally signed invoice · Order {order.orderNumber}
          </span>
          <span className="font-mono">Payment Status: {order.paymentStatus}</span>
        </div>
      </div>
    </div>
  );
};

export const EditOrderModal: React.FC<{
  order: any;
  products: any[];
  authToken: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}> = ({ order, products, authToken, onClose, onSaved }) => {
  const parsedBilling = (() => {
    try {
      const p = JSON.parse(order.billingAddress || '{}');
      return p && typeof p === 'object' ? p : { line1: order.billingAddress || '' };
    } catch {
      return { line1: order.billingAddress || '' };
    }
  })();

  const [customerName, setCustomerName] = useState<string>(order.customerName || '');
  const [customerEmail, setCustomerEmail] = useState<string>(order.customerEmail || '');
  const [customerMobile, setCustomerMobile] = useState<string>(order.customerMobile || '');
  const [customerGstin, setCustomerGstin] = useState<string>(parsedBilling.gstin || '');
  const [companyName, setCompanyName] = useState<string>(parsedBilling.companyName || '');
  const [billingAddressLine, setBillingAddressLine] = useState<string>(
    [parsedBilling.line1, parsedBilling.city, parsedBilling.state, parsedBilling.postalCode]
      .filter(Boolean)
      .join(', ') ||
      order.billingAddress ||
      ''
  );
  const [shippingAddressLine, setShippingAddressLine] = useState<string>(() => {
    try {
      const p = JSON.parse(order.shippingAddress || '{}');
      if (p && typeof p === 'object') {
        return [p.line1, p.city, p.state, p.postalCode].filter(Boolean).join(', ');
      }
      return order.shippingAddress || '';
    } catch {
      return order.shippingAddress || '';
    }
  });
  const [customReference, setCustomReference] = useState<string>(order.customReference || '');
  const [invoiceNumber, setInvoiceNumber] = useState<string>(order.invoiceNumber || '');
  const [isPrivateLinkOrder, setIsPrivateLinkOrder] = useState<boolean>(
    Boolean(order.isPrivateLinkOrder)
  );
  const [orderStatus, setOrderStatus] = useState<string>(order.orderStatus || 'Pending Payment');
  const [paymentStatus, setPaymentStatus] = useState<string>(order.paymentStatus || 'Pending');
  const [fulfillmentStatus, setFulfillmentStatus] = useState<string>(
    order.fulfillmentStatus || 'Unfulfilled'
  );
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState<string>(
    order.shippingTrackingNumber || ''
  );
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState<string>(
    order.estimatedDeliveryDate || ''
  );
  const [internalNotes, setInternalNotes] = useState<string>(order.internalNotes || '');
  const [shippingRupees, setShippingRupees] = useState<string>(
    ((order.shippingChargesPaise || 0) / 100).toFixed(2)
  );
  const [discountRupees, setDiscountRupees] = useState<string>(
    ((order.discountAmountPaise || 0) / 100).toFixed(2)
  );

  const [items, setItems] = useState<
    Array<{
      productId?: number;
      sku: string;
      name: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      taxRatePercent: number;
    }>
  >(() => {
    try {
      const parsed = JSON.parse(order.itemsJson || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Fallback below
    }
    return [
      {
        sku: 'ALT-CUSTOM-01',
        name: 'Enterprise Service Item',
        description: 'Custom Order Line Item',
        quantity: 1,
        unitPricePaise: order.subtotalPaise || 100000,
        taxRatePercent: 18,
      },
    ];
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedSubtotalPaise = items.reduce(
    (sum, it) => sum + Math.round(Number(it.unitPricePaise || 0)) * Math.max(1, Number(it.quantity || 1)),
    0
  );
  const computedTaxPaise = items.reduce(
    (sum, it) =>
      sum +
      Math.round(
        (Math.round(Number(it.unitPricePaise || 0)) *
          Math.max(1, Number(it.quantity || 1)) *
          Number(it.taxRatePercent ?? 18)) /
          100
      ),
    0
  );
  const shippingPaise = Math.max(0, Math.round(Number(shippingRupees || 0) * 100));
  const discountPaise = Math.max(0, Math.round(Number(discountRupees || 0) * 100));
  const computedTotalPaise = Math.max(
    100,
    computedSubtotalPaise + computedTaxPaise + shippingPaise - discountPaise
  );

  const handleAddLineItem = () => {
    const p = products[0];
    setItems((prev) => [
      ...prev,
      {
        productId: p?.id,
        sku: p?.sku || 'ALT-ITEM-NEW',
        name: p?.name || 'Additional Service Line Item',
        description: p?.description || 'Enterprise deployment item',
        quantity: 1,
        unitPricePaise: p?.unitPricePaise || 100000,
        taxRatePercent: p?.taxRatePercent ?? 18,
      },
    ]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const updatedBillingJson = JSON.stringify({
        ...parsedBilling,
        line1: billingAddressLine.trim(),
        gstin: customerGstin.trim().toUpperCase() || undefined,
        companyName: companyName.trim() || undefined,
      });

      const res = await fetch(`/api/v1/orders/${order.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerMobile: customerMobile.trim(),
          customerGstin: customerGstin.trim().toUpperCase(),
          companyName: companyName.trim(),
          billingAddress: updatedBillingJson,
          shippingAddress: shippingAddressLine.trim() || updatedBillingJson,
          customReference: customReference.trim(),
          invoiceNumber: invoiceNumber.trim(),
          isPrivateLinkOrder,
          items,
          subtotalPaise: computedSubtotalPaise,
          taxAmountPaise: computedTaxPaise,
          shippingChargesPaise: shippingPaise,
          discountAmountPaise: discountPaise,
          totalAmountPaise: computedTotalPaise,
          orderStatus,
          paymentStatus,
          fulfillmentStatus,
          shippingTrackingNumber: shippingTrackingNumber.trim() || null,
          estimatedDeliveryDate: estimatedDeliveryDate.trim() || null,
          internalNotes: internalNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update order information');
      } else {
        await onSaved();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Network error while updating order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">
                Edit {isPrivateLinkOrder ? 'Private Link' : 'Public Storefront'} Order Information
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-mono text-emerald-300">
                {order.orderNumber}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Modify customer details, GSTIN, line items, pricing, order type (Public/Private), and
              fulfillment status
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 text-xs p-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* Customer & GSTIN Section */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Customer Full Name *</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Customer Email *</label>
              <input
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Customer Mobile *</label>
              <input
                type="text"
                required
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Customer GSTIN (15-Digit GST No.)</label>
              <input
                type="text"
                maxLength={15}
                value={customerGstin}
                onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                placeholder="29ABCDE1234F1Z5"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-emerald-300 uppercase"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Company / Organization Name</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Enterprise Pvt Ltd"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Order Classification</label>
              <select
                value={isPrivateLinkOrder ? 'PRIVATE' : 'PUBLIC'}
                onChange={(e) => setIsPrivateLinkOrder(e.target.value === 'PRIVATE')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value="PUBLIC">Public Storefront Order (/checkout)</option>
                <option value="PRIVATE">Private Purchase Link Order (/pay/:token)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Billing Address</label>
              <input
                type="text"
                value={billingAddressLine}
                onChange={(e) => setBillingAddressLine(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Shipping Address</label>
              <input
                type="text"
                value={shippingAddressLine}
                onChange={(e) => setShippingAddressLine(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
          </div>

          {/* Line Items Editor */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-200">
                Order Line Items &amp; Pricing (INR)
              </label>
              <button
                type="button"
                onClick={handleAddLineItem}
                className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Line Item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-slate-950 border border-slate-800 rounded-lg p-2.5"
                >
                  <div className="col-span-4">
                    <label className="block text-[10px] text-slate-500 mb-0.5">Product Name</label>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row))
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-100"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-500 mb-0.5">SKU</label>
                    <input
                      type="text"
                      value={item.sku}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, sku: e.target.value } : row))
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-500 mb-0.5">Qty</label>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? { ...row, quantity: Math.max(1, Number(e.target.value)) }
                              : row
                          )
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-center text-slate-100"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-500 mb-0.5">
                      Unit Price (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={1}
                      value={(item.unitPricePaise / 100).toFixed(2)}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  unitPricePaise: Math.max(
                                    100,
                                    Math.round(Number(e.target.value || 0) * 100)
                                  ),
                                }
                              : row
                          )
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[10px] text-slate-500 mb-0.5">GST%</label>
                    <input
                      type="number"
                      min={0}
                      max={28}
                      value={item.taxRatePercent ?? 18}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? { ...row, taxRatePercent: Number(e.target.value || 0) }
                              : row
                          )
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-1 font-mono text-center text-slate-100"
                    />
                  </div>
                  <div className="col-span-1 text-right pt-4">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status, Reference & Financials */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-slate-400 mb-1">Order Status</label>
              <select
                value={orderStatus}
                onChange={(e) => setOrderStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100"
              >
                {[
                  'Pending Payment',
                  'Payment Initiated',
                  'Paid',
                  'Processing',
                  'Shipped',
                  'Completed',
                  'Payment Failed',
                  'Cancelled',
                  'Refunded',
                ].map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Payment Status</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100"
              >
                {['Pending', 'Captured', 'Failed', 'Partially Refunded', 'Refunded'].map((ps) => (
                  <option key={ps} value={ps}>
                    {ps}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Fulfillment Status</label>
              <select
                value={fulfillmentStatus}
                onChange={(e) => setFulfillmentStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100"
              >
                {['Unfulfilled', 'Allocated', 'In Transit', 'Fulfilled', 'Returned'].map((fs) => (
                  <option key={fs} value={fs}>
                    {fs}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Invoice Number</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Shipping Charges (₹)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={shippingRupees}
                onChange={(e) => setShippingRupees(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Discount Amount (₹)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={discountRupees}
                onChange={(e) => setDiscountRupees(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Courier Tracking #</label>
              <input
                type="text"
                value={shippingTrackingNumber}
                onChange={(e) => setShippingTrackingNumber(e.target.value)}
                placeholder="BLUEDART-881209"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Estimated Delivery Date</label>
              <input
                type="text"
                value={estimatedDeliveryDate}
                onChange={(e) => setEstimatedDeliveryDate(e.target.value)}
                placeholder="2026-11-20"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-slate-400 mb-1">Internal Admin Audit Note</label>
              <input
                type="text"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Reason for order edit / B2B GST adjustment"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-right space-y-0.5">
              <div className="text-slate-400">
                Subtotal: <span className="font-mono text-slate-200">₹{(computedSubtotalPaise / 100).toFixed(2)}</span>{' '}
                · GST: <span className="font-mono text-slate-200">₹{(computedTaxPaise / 100).toFixed(2)}</span>
              </div>
              <div className="text-sm font-bold text-emerald-400 font-mono">
                Updated Order Total: ₹{(computedTotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
            >
              {submitting ? 'Saving Changes...' : 'Save Order Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const EditProductModal: React.FC<{
  product: any;
  authToken: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}> = ({ product, authToken, onClose, onSaved }) => {
  const [name, setName] = useState<string>(product.name || '');
  const [sku, setSku] = useState<string>(product.sku || '');
  const [description, setDescription] = useState<string>(product.description || '');
  const [category, setCategory] = useState<string>(product.category || '');
  const [unitPriceRupees, setUnitPriceRupees] = useState<string>(
    ((product.unitPricePaise || 0) / 100).toFixed(2)
  );
  const [taxRatePercent, setTaxRatePercent] = useState<string>(
    String(product.taxRatePercent ?? 18)
  );
  const [hsnSacCode, setHsnSacCode] = useState<string>(product.hsnSacCode || '998314');
  const [shippingRupees, setShippingRupees] = useState<string>(
    ((product.shippingChargesPaise || 0) / 100).toFixed(2)
  );
  const [stockQuantity, setStockQuantity] = useState<string>(String(product.stockQuantity ?? 25));
  const [maxQuantityPerOrder, setMaxQuantityPerOrder] = useState<string>(
    String(product.maxQuantityPerOrder ?? 5)
  );
  const [allowQuantitySelection, setAllowQuantitySelection] = useState<boolean>(
    Boolean(product.allowQuantitySelection)
  );
  const [isPrivate, setIsPrivate] = useState<boolean>(Boolean(product.isPrivate));
  const [active, setActive] = useState<boolean>(product.active !== false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch(`/api/v1/products/${product.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          description: description.trim(),
          category: category.trim(),
          unitPricePaise: Math.max(100, Math.round(Number(unitPriceRupees || 0) * 100)),
          taxRatePercent: Number(taxRatePercent || 18),
          hsnSacCode: hsnSacCode.trim(),
          shippingChargesPaise: Math.max(0, Math.round(Number(shippingRupees || 0) * 100)),
          stockQuantity: Math.max(0, Number(stockQuantity || 0)),
          maxQuantityPerOrder: Math.max(1, Number(maxQuantityPerOrder || 1)),
          allowQuantitySelection,
          isPrivate,
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update product');
      } else {
        await onSaved();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Network error while updating product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white">
              Edit {isPrivate ? 'Private' : 'Public'} Product Details
            </h2>
            <p className="text-xs text-slate-400 font-mono">{product.sku}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 text-xs p-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Product Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Product SKU *</label>
              <input
                type="text"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Unit Price (INR ₹) *</label>
              <input
                type="number"
                step="0.01"
                min={1}
                required
                value={unitPriceRupees}
                onChange={(e) => setUnitPriceRupees(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">GST Rate (%) &amp; HSN/SAC</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(e.target.value)}
                  placeholder="18"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
                />
                <input
                  type="text"
                  value={hsnSacCode}
                  onChange={(e) => setHsnSacCode(e.target.value)}
                  placeholder="998314"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Shipping Charges (INR ₹)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={shippingRupees}
                onChange={(e) => setShippingRupees(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Stock Quantity</label>
              <input
                type="number"
                min={0}
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Visibility Mode</label>
              <select
                value={isPrivate ? 'PRIVATE' : 'PUBLIC'}
                onChange={(e) => setIsPrivate(e.target.value === 'PRIVATE')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value="PUBLIC">Public Catalogue Product</option>
                <option value="PRIVATE">Private Link-Only Product</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Product Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={allowQuantitySelection}
                onChange={(e) => setAllowQuantitySelection(e.target.checked)}
                className="rounded border-slate-700"
              />
              <span>Allow Quantity Selection (Max {maxQuantityPerOrder})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-slate-700"
              />
              <span>Product Active</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium bg-slate-800 text-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
            >
              {submitting ? 'Saving...' : 'Save Product Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

