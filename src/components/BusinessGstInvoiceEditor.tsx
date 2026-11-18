import React, { useEffect, useState } from 'react';
import {
  Building2,
  FileText,
  Save,
  CheckCircle2,
  Landmark,
  ShieldCheck,
  Printer,
  Edit3,
  RefreshCw,
} from 'lucide-react';

export interface BusinessGstConfig {
  merchantGstin: string;
  legalEntityName: string;
  brandName: string;
  panNumber: string;
  cinNumber: string;
  stateCode: string;
  defaultHsnSac: string;
  defaultGstPercent: number;
  taxBreakdownMode: string;
  registeredAddress: string;
  corporateOfficeAddress: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
  invoicePrefix: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  bankUpiId: string;
  authorizedSignatory: string;
  invoiceFooterNotes: string;
  invoiceTerms: string;
}

const DEFAULT_GST_CONFIG: BusinessGstConfig = {
  merchantGstin: '',
  legalEntityName: '',
  brandName: '',
  panNumber: '',
  cinNumber: '',
  stateCode: '',
  defaultHsnSac: '998314',
  defaultGstPercent: 18,
  taxBreakdownMode: 'AUTO',
  registeredAddress: '',
  corporateOfficeAddress: '',
  supportEmail: '',
  supportPhone: '',
  websiteUrl: 'https://checkout.xperiserv.in',
  invoicePrefix: 'INV-',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfscCode: '',
  bankUpiId: '',
  authorizedSignatory: '',
  invoiceFooterNotes: '',
  invoiceTerms: '',
};

export const BusinessGstInvoiceEditor: React.FC<{
  initialConfig?: Partial<BusinessGstConfig>;
  orders?: any[];
  authToken?: string | null;
  showToast: (msg: string) => void;
  onSaved: () => Promise<void>;
  onOpenInvoiceModal?: (order: any) => void;
  onOpenEditOrderModal?: (order: any) => void;
}> = ({
  initialConfig,
  orders = [],
  authToken,
  showToast,
  onSaved,
  onOpenInvoiceModal,
  onOpenEditOrderModal,
}) => {
  const [form, setForm] = useState<BusinessGstConfig>(() => ({
    ...DEFAULT_GST_CONFIG,
    ...(initialConfig || {}),
  }));
  const [syncExistingInvoices, setSyncExistingInvoices] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    if (initialConfig && Object.keys(initialConfig).length > 0) {
      setForm((prev) => ({
        ...prev,
        ...initialConfig,
      }));
    }
  }, [initialConfig]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedBanner(null);
    setErrorBanner(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch('/api/v1/merchant-tax-config', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          ...form,
          merchantGstin: form.merchantGstin.trim().toUpperCase(),
          panNumber: form.panNumber.trim().toUpperCase(),
          cinNumber: form.cinNumber.trim().toUpperCase(),
          bankIfscCode: form.bankIfscCode.trim().toUpperCase(),
          defaultGstPercent: Number(form.defaultGstPercent || 18),
          syncExistingInvoices,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update Business GST & Invoice settings');
      }
      if (data.merchantTaxConfig) {
        setForm((prev) => ({ ...prev, ...data.merchantTaxConfig }));
      }
      await onSaved();
      const msg = syncExistingInvoices
        ? `Saved Business GSTIN (${form.merchantGstin.toUpperCase()}) & synced all order invoices`
        : `Saved Business GSTIN (${form.merchantGstin.toUpperCase()}) & Invoice Settings`;
      setSavedBanner(msg);
      showToast(msg);
    } catch (err: any) {
      setErrorBanner(err.message || 'Network error while saving Business GST settings');
    } finally {
      setSaving(false);
    }
  };

  const formatINR = (paise: number) =>
    `₹${((paise || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="space-y-6 text-xs">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">
              Business GST, Legal Company Profile &amp; Tax Invoice Customization
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Update your Business 15-Digit GSTIN, PAN, CIN, Registered Office Address, HSN/SAC codes,
            Bank Settlement details, and GST Tax Invoice template across all public and private orders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/30 font-mono text-emerald-300 font-semibold">
            Active GSTIN: {form.merchantGstin || 'Not Configured'}
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-300">
            Prefix: {form.invoicePrefix || 'INV-'}
          </span>
        </div>
      </div>

      {savedBanner && (
        <div className="bg-emerald-950/70 border border-emerald-700 text-emerald-200 px-4 py-3 rounded-xl flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            {savedBanner}
          </span>
          <button
            type="button"
            onClick={() => setSavedBanner(null)}
            className="text-emerald-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="bg-rose-950/70 border border-rose-800 text-rose-200 px-4 py-3 rounded-xl">
          {errorBanner}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Columns: Business GST & Invoice Settings Form */}
        <form
          onSubmit={handleSaveConfig}
          className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5"
        >
          {/* Section 1: Business Legal Identity & Contact Info */}
          <div className="space-y-3">
            <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                1. Business Legal Identity &amp; Contact Information
              </h3>
              <span className="text-[11px] font-mono text-slate-400">Supplier Header on Invoices</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">
                  Legal Business / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={form.legalEntityName}
                  onChange={(e) => setForm({ ...form, legalEntityName: e.target.value })}
                  placeholder="Enter Legal Business Name"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Brand / Trade Name</label>
                <input
                  type="text"
                  value={form.brandName}
                  onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                  placeholder="Enter Brand or Trade Name"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Billing &amp; Support Email</label>
                <input
                  type="email"
                  value={form.supportEmail}
                  onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                  placeholder="billing@yourdomain.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Business Contact Phone</label>
                <input
                  type="text"
                  value={form.supportPhone}
                  onChange={(e) => setForm({ ...form, supportPhone: e.target.value })}
                  placeholder="+91 XXXXX XXXXX"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">Official Website / Checkout URL</label>
                <input
                  type="text"
                  value={form.websiteUrl}
                  onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
                  placeholder="https://checkout.xperiserv.in"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-emerald-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">
                  Registered Office Address (Printed on GST Invoice)
                </label>
                <input
                  type="text"
                  value={form.registeredAddress}
                  onChange={(e) => setForm({ ...form, registeredAddress: e.target.value })}
                  placeholder="Street, City, State, PIN Code"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">
                  Corporate / Operations Office Address (Secondary)
                </label>
                <input
                  type="text"
                  value={form.corporateOfficeAddress}
                  onChange={(e) => setForm({ ...form, corporateOfficeAddress: e.target.value })}
                  placeholder="Optional secondary office address"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Business GSTIN, PAN, CIN & Tax Rules */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                2. Business GST Registration, Statutory Numbers &amp; Tax Rules
              </h3>
              <span className="text-[11px] font-mono text-amber-300">GST Compliance</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">
                  Business GSTIN (15-Digit GST No.)
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={form.merchantGstin}
                  onChange={(e) => setForm({ ...form, merchantGstin: e.target.value.toUpperCase() })}
                  placeholder="15-character GSTIN"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-emerald-400 font-bold uppercase"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Business PAN Number</label>
                <input
                  type="text"
                  maxLength={10}
                  value={form.panNumber}
                  onChange={(e) => setForm({ ...form, panNumber: e.target.value.toUpperCase() })}
                  placeholder="10-character PAN"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white uppercase"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">CIN / Registration Number</label>
                <input
                  type="text"
                  value={form.cinNumber}
                  onChange={(e) => setForm({ ...form, cinNumber: e.target.value.toUpperCase() })}
                  placeholder="CIN or MSME / Reg No."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white uppercase"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Place of Origin / State Code</label>
                <input
                  type="text"
                  value={form.stateCode}
                  onChange={(e) => setForm({ ...form, stateCode: e.target.value })}
                  placeholder="e.g. 27 (Maharashtra) or 21 (Odisha)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Default HSN / SAC Code</label>
                <input
                  type="text"
                  value={form.defaultHsnSac}
                  onChange={(e) => setForm({ ...form, defaultHsnSac: e.target.value })}
                  placeholder="998314"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Default GST Rate (%)</label>
                <input
                  type="number"
                  min={0}
                  max={28}
                  value={form.defaultGstPercent}
                  onChange={(e) =>
                    setForm({ ...form, defaultGstPercent: Number(e.target.value || 18) })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">
                  Invoice Tax Breakdown Mode (CGST+SGST vs IGST)
                </label>
                <select
                  value={form.taxBreakdownMode}
                  onChange={(e) => setForm({ ...form, taxBreakdownMode: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                >
                  <option value="AUTO">
                    Automatic (CGST+SGST if Customer GSTIN matches Business State Code, else IGST)
                  </option>
                  <option value="CGST_SGST">Always Split Intra-State (CGST 9% + SGST 9%)</option>
                  <option value="IGST">Always Inter-State (IGST 18%)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Invoice Number Prefix</label>
                <input
                  type="text"
                  value={form.invoicePrefix}
                  onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                  placeholder="INV-"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-emerald-400"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Bank Settlement Details & Signatory on Invoice */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Landmark className="w-4 h-4 text-sky-400" />
                3. Bank Settlement Details, Signatory &amp; Invoice Terms
              </h3>
              <span className="text-[11px] font-mono text-sky-300">Invoice Footer</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Bank Name &amp; Branch</label>
                <input
                  type="text"
                  value={form.bankName}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Beneficiary Account Name</label>
                <input
                  type="text"
                  value={form.bankAccountName}
                  onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Bank Account Number</label>
                <input
                  type="text"
                  value={form.bankAccountNumber}
                  onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">IFSC Code</label>
                  <input
                    type="text"
                    value={form.bankIfscCode}
                    onChange={(e) =>
                      setForm({ ...form, bankIfscCode: e.target.value.toUpperCase() })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-white uppercase"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Corporate UPI ID</label>
                  <input
                    type="text"
                    value={form.bankUpiId}
                    onChange={(e) => setForm({ ...form, bankUpiId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-emerald-400"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">
                  Authorized Signatory Line (Printed at Bottom Right of Invoice)
                </label>
                <input
                  type="text"
                  value={form.authorizedSignatory}
                  onChange={(e) => setForm({ ...form, authorizedSignatory: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">
                  GST Statutory Declaration / Footer Note
                </label>
                <input
                  type="text"
                  value={form.invoiceFooterNotes}
                  onChange={(e) => setForm({ ...form, invoiceFooterNotes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">Invoice Terms &amp; SLA Note</label>
                <input
                  type="text"
                  value={form.invoiceTerms}
                  onChange={(e) => setForm({ ...form, invoiceTerms: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={syncExistingInvoices}
                onChange={(e) => setSyncExistingInvoices(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              <span>Apply updated Business GST &amp; Company info to all existing order invoices</span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving Business GST & Invoice Settings...' : 'Save Business GST & Invoice Info'}
            </button>
          </div>
        </form>

        {/* Right 5 Columns: Live GST Tax Invoice Template Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 block">
                  Live Tax Invoice Preview
                </span>
                <h3 className="text-sm font-bold text-white font-mono">
                  {form.invoicePrefix || 'INV-'}1042
                </h3>
              </div>
              <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300">
                GST {form.defaultGstPercent || 18}% · SAC {form.defaultHsnSac || '998314'}
              </span>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                  Issued By (Supplier / Business Details)
                </div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {form.legalEntityName || 'Not Configured'}
                </div>
                <div className="text-[11px] text-slate-300">
                  Brand: {form.brandName || '—'} · {form.websiteUrl}
                </div>
                {form.registeredAddress && (
                  <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    {form.registeredAddress}
                  </div>
                )}
                {form.corporateOfficeAddress && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Corp Office: {form.corporateOfficeAddress}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 font-mono text-[11px]">
                <div>
                  <span className="text-slate-500 block text-[10px]">BUSINESS GSTIN</span>
                  <span className="text-emerald-400 font-bold">{form.merchantGstin || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">BUSINESS PAN</span>
                  <span className="text-slate-200">{form.panNumber || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">CIN / REG NO.</span>
                  <span className="text-slate-300">{form.cinNumber || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">STATE &amp; SAC CODE</span>
                  <span className="text-slate-300">
                    {form.stateCode || '—'} · {form.defaultHsnSac || '—'}
                  </span>
                </div>
              </div>

              {(form.bankName || form.bankAccountNumber || form.bankIfscCode || form.bankUpiId) && (
                <div className="pt-2 border-t border-slate-800/80 text-[11px] space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    Bank &amp; Settlement Footer
                  </div>
                  <div className="text-slate-200 font-medium">{form.bankName}</div>
                  <div className="font-mono text-slate-300">
                    A/C: {form.bankAccountNumber || '—'} · IFSC: {form.bankIfscCode || '—'}
                  </div>
                  {form.bankUpiId && (
                    <div className="font-mono text-emerald-400">UPI: {form.bankUpiId}</div>
                  )}
                </div>
              )}

              {(form.invoiceFooterNotes || form.authorizedSignatory) && (
                <div className="pt-2 border-t border-slate-800/80 text-[11px] space-y-1">
                  <div className="text-slate-400 leading-relaxed">{form.invoiceFooterNotes}</div>
                  <div className="text-right font-semibold text-slate-200 pt-2">
                    {form.authorizedSignatory}
                  </div>
                </div>
              )}
            </div>

            {orders.length > 0 && onOpenInvoiceModal && (
              <button
                type="button"
                onClick={() => onOpenInvoiceModal(orders[0])}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold rounded-lg border border-slate-700 flex items-center justify-center gap-2 transition-colors"
              >
                <Printer className="w-3.5 h-3.5 text-emerald-400" />
                Open Interactive Order Invoice Preview &amp; Editor
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: Order GST Invoices & Customer GSTIN Ledger */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              Order GST Tax Invoices &amp; Customer GSTIN Directory ({orders.length})
            </h3>
            <p className="text-xs text-slate-400">
              Click <span className="text-amber-300 font-semibold">Edit Invoice &amp; GST</span> on any
              public or private order to customize its Invoice Number, Customer GSTIN, Company Name,
              HSN/SAC, or Business GST details.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                <th className="py-3 px-4">Invoice # &amp; Order #</th>
                <th className="py-3 px-4">Order Type</th>
                <th className="py-3 px-4">Customer &amp; Company</th>
                <th className="py-3 px-4">Customer GSTIN</th>
                <th className="py-3 px-4">Business GSTIN</th>
                <th className="py-3 px-4 text-right">Taxable + GST</th>
                <th className="py-3 px-4 text-right">Invoice Total</th>
                <th className="py-3 px-4 text-right">Invoice &amp; Order Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No orders found. Create a public or private order to generate GST Tax Invoices.
                  </td>
                </tr>
              ) : (
                orders.map((ord: any) => {
                  const bill = (() => {
                    try {
                      return JSON.parse(ord.billingAddress || '{}');
                    } catch {
                      return {};
                    }
                  })();
                  return (
                    <tr key={ord.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-white">
                          {ord.invoiceNumber || `${form.invoicePrefix}${ord.id}`}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {ord.orderNumber}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {ord.isPrivateLinkOrder ? (
                          <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-amber-950/80 text-amber-300 border border-amber-500/30">
                            Private Link
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-300">
                            Public Order
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-100">{ord.customerName}</div>
                        {bill.companyName && (
                          <div className="text-[11px] text-slate-300">{bill.companyName}</div>
                        )}
                        <div className="text-[10px] text-slate-500">{ord.customerEmail}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {bill.gstin ? (
                          <span className="text-emerald-400 font-semibold">{bill.gstin}</span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">B2C / Unregistered</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {bill.merchantGstin || form.merchantGstin}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        <div className="text-slate-300">{formatINR(ord.subtotalPaise)}</div>
                        <div className="text-[10px] text-slate-400">
                          + GST {formatINR(ord.taxAmountPaise)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatINR(ord.totalAmountPaise)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {onOpenInvoiceModal && (
                            <button
                              type="button"
                              onClick={() => onOpenInvoiceModal(ord)}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 rounded hover:bg-emerald-600/30 flex items-center gap-1"
                            >
                              <FileText className="w-3 h-3" />
                              Invoice &amp; GST
                            </button>
                          )}
                          {onOpenEditOrderModal && (
                            <button
                              type="button"
                              onClick={() => onOpenEditOrderModal(ord)}
                              className="px-2.5 py-1 text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded hover:bg-amber-500/30 flex items-center gap-1"
                            >
                              <Edit3 className="w-3 h-3" />
                              Edit Order
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
