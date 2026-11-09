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
            <div className="text-xs text-emerald-400 font-semibold">
              Allientic Lab Technologies · GST Tax Invoice
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
            <div className="text-slate-500 mb-1">Issued By</div>
            <div className="font-semibold text-white">Allientic Lab Technologies</div>
            <div className="text-slate-400">https://checkout.xperiserv.in</div>
            <div className="text-slate-400 font-mono">GSTIN: 29AABCA8891D1Z5</div>
          </div>
          <div className="text-right">
            <div className="text-slate-500 mb-1">Billed To</div>
            <div className="font-semibold text-white">{order.customerName}</div>
            <div className="text-slate-400">{order.customerEmail}</div>
            <div className="text-slate-400 font-mono">{order.customerMobile}</div>
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
                  <div className="text-[11px] font-mono text-slate-500">{item.sku}</div>
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
            <span>IGST / CGST+SGST (18%)</span>
            <span className="font-mono text-slate-200">{formatINR(order.taxAmountPaise)}</span>
          </div>
          {order.discountAmountPaise > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Discount ({order.couponCode})</span>
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
