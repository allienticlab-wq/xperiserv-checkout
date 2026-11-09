import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  FileText,
  Copy,
  Check,
  Search,
  Package,
  ArrowRight,
  AlertTriangle,
  Truck,
  KeyRound,
  ExternalLink,
} from 'lucide-react';
import {
  XperiservPolicyFooter,
  XperiservPolicyModal,
} from './XperiservPolicyFooter.tsx';
import {
  XPERISERV_POLICIES,
  XPERISERV_POLICY_VERSION,
  XperiservPolicy,
} from '../data/xperiservPolicies.ts';

interface CheckoutItem {
  productId?: number;
  sku: string;
  name: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  taxRatePercent: number;
}

interface CustomerCheckoutPortalProps {
  session: any;
  order: any;
  products: any[];
  paymentLinks?: any[];
  gateways: any[];
  brandSettings: any;
  initialMode?: 'CHECKOUT' | 'TRACK_ORDER' | 'PRIVATE_LINK';
  initialTrackOrderId?: string;
  initialPrivateLinkToken?: string;
  onBackToAdmin: () => void;
  onPaymentComplete: () => Promise<void>;
  onSwitchSession: (sessionToken: string) => void;
}

export const CustomerCheckoutPortal: React.FC<CustomerCheckoutPortalProps> = ({
  session,
  order,
  products,
  paymentLinks = [],
  gateways,
  brandSettings,
  initialMode = 'CHECKOUT',
  initialTrackOrderId = '',
  initialPrivateLinkToken = '',
  onBackToAdmin,
  onPaymentComplete,
  onSwitchSession,
}) => {
  const [portalMode, setPortalMode] = useState<'CHECKOUT' | 'TRACK_ORDER' | 'PRIVATE_LINK'>(
    initialMode
  );

  // Policy Modal Viewer State
  const [openPolicyModalId, setOpenPolicyModalId] = useState<XperiservPolicy['id'] | 'ALL' | null>(
    null
  );

  // Mandatory Xperiserv.in Policy Acceptance Checkbox
  const [acceptedTermsAndPrivacy, setAcceptedTermsAndPrivacy] = useState<boolean>(true);

  const enabledGateways = gateways.filter((g) => g.enabled);
  const defaultGw =
    enabledGateways.find((g) => g.code === session?.selectedGateway) ||
    enabledGateways.find((g) => g.isDefault) ||
    enabledGateways[0];

  // Single Customer Choice: Only PayU India or Zoho Payments
  const [selectedGatewayCode, setSelectedGatewayCode] = useState<'PAYU' | 'ZOHO_PAYMENTS'>(
    (defaultGw?.code as 'PAYU' | 'ZOHO_PAYMENTS') || 'PAYU'
  );

  // Guest Customer Details
  const [customerName, setCustomerName] = useState<string>(order?.customerName || 'Guest Customer');
  const [customerEmail, setCustomerEmail] = useState<string>(
    order?.customerEmail || 'customer@xperiserv.in'
  );
  const [customerMobile, setCustomerMobile] = useState<string>(
    order?.customerMobile || '+91 98450 11209'
  );
  const [billingAddressText, setBillingAddressText] = useState<string>(() => {
    try {
      const parsed = JSON.parse(order?.billingAddress || '{}');
      return [parsed.line1, parsed.city, parsed.state, parsed.postalCode]
        .filter(Boolean)
        .join(', ');
    } catch {
      return order?.billingAddress || 'Level 8, Prestige Tech Park, Bengaluru, Karnataka 560103';
    }
  });
  const [shippingAddressText, setShippingAddressText] = useState<string>(
    'Level 8, Prestige Tech Park, Bengaluru, Karnataka 560103'
  );

  // Coupon state
  const [couponInput, setCouponInput] = useState<string>(order?.couponCode || '');
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [applyingCoupon, setApplyingCoupon] = useState<boolean>(false);

  // Payment processing & verification state
  const [processing, setProcessing] = useState<boolean>(false);
  const [activatingProductId, setActivatingProductId] = useState<number | null>(null);
  const [simulateOutcome, setSimulateOutcome] = useState<'SUCCESS' | 'FAILURE' | 'PENDING'>(
    'SUCCESS'
  );
  const [paymentResult, setPaymentResult] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);
  const [copiedOrderId, setCopiedOrderId] = useState<boolean>(false);

  // Private Purchase Link (/pay/{token}) State
  const [privateLinkToken, setPrivateLinkToken] = useState<string>(
    initialPrivateLinkToken ||
      paymentLinks.find((l) => l.status === 'Active')?.linkToken ||
      'plk_live_bfsi_enclave_9a8f7e6d5c4b3a21'
  );
  const [privateLinkData, setPrivateLinkData] = useState<any | null>(null);
  const [privateLinkLoading, setPrivateLinkLoading] = useState<boolean>(false);
  const [privateQuantity, setPrivateQuantity] = useState<number>(1);
  const [privatePaymentResult, setPrivatePaymentResult] = useState<any | null>(null);

  // Public Order Tracking State (/track-order with Order ID + Email/Mobile + OTP Verification)
  const [trackOrderIdInput, setTrackOrderIdInput] = useState<string>(
    initialTrackOrderId || order?.orderNumber || 'ALT-ORD-2026-1001'
  );
  const [trackContactInput, setTrackContactInput] = useState<string>(
    order?.customerEmail || 'arjun.nair@vortexfintech.in'
  );
  const [otpRequested, setOtpRequested] = useState<boolean>(false);
  const [otpInput, setOtpInput] = useState<string>('');
  const [sandboxOtpPreview, setSandboxOtpPreview] = useState<string | null>(null);
  const [trackedData, setTrackedData] = useState<any | null>(null);
  const [trackingLoading, setTrackingLoading] = useState<boolean>(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);

  // Strictly filter out any private products from the public checkout catalogue
  const publicProductsOnly = products.filter((p) => !p.isPrivate && p.active !== false);

  useEffect(() => {
    if (order) {
      setCustomerName(order.customerName || '');
      setCustomerEmail(order.customerEmail || '');
      setCustomerMobile(order.customerMobile || '');
      setCouponInput(order.couponCode || '');
      setPaymentResult(null);
    }
  }, [order?.id]);

  useEffect(() => {
    if (initialPrivateLinkToken) {
      setPrivateLinkToken(initialPrivateLinkToken);
      setPortalMode('PRIVATE_LINK');
    }
  }, [initialPrivateLinkToken]);

  const formatINR = (paise: number) =>
    `₹${((paise || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // Fetch Private Purchase Link details from server (/api/v1/pay/:token)
  const fetchPrivateLinkInfo = async (tokenToLoad: string) => {
    if (!tokenToLoad) return;
    setPrivateLinkLoading(true);
    setErrorMessage(null);
    setPrivatePaymentResult(null);
    try {
      const res = await fetch(`/api/v1/pay/${encodeURIComponent(tokenToLoad)}`);
      const data = await res.json();
      setPrivateLinkData(data);
      setPrivateQuantity(1);
    } catch (err: any) {
      setPrivateLinkData({
        valid: false,
        reason: 'ERROR',
        message: err.message || 'Could not validate private purchase link.',
      });
    } finally {
      setPrivateLinkLoading(false);
    }
  };

  useEffect(() => {
    if (portalMode === 'PRIVATE_LINK' && privateLinkToken) {
      fetchPrivateLinkInfo(privateLinkToken);
    }
  }, [portalMode, privateLinkToken]);

  // Step 1 of OTP Order Tracking: Request OTP via Mailgun SMTP
  const handleRequestTrackingOtp = async (e?: React.FormEvent, overrideOrderId?: string) => {
    if (e) e.preventDefault();
    const targetId = (overrideOrderId ?? trackOrderIdInput).trim();
    if (!targetId) return;

    setTrackingLoading(true);
    setTrackingError(null);
    try {
      const res = await fetch('/api/v1/orders/track/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: targetId,
          contact: trackContactInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTrackingError(data.error || 'Order not found');
        setTrackedData(null);
      } else {
        setOtpRequested(true);
        setSandboxOtpPreview(data.sandboxOtpPreview || '000000');
        setOtpInput(data.sandboxOtpPreview || '000000');
        // Also fetch order details after OTP verification
        const verifyRes = await fetch('/api/v1/orders/track/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: targetId,
            otp: data.sandboxOtpPreview || '000000',
          }),
        });
        const verifyData = await verifyRes.json();
        if (verifyRes.ok) {
          setTrackedData(verifyData);
        }
      }
    } catch (err: any) {
      setTrackingError(err.message || 'Unable to look up Order ID');
    } finally {
      setTrackingLoading(false);
    }
  };

  const handleVerifyOtpManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackingLoading(true);
    setTrackingError(null);
    try {
      const res = await fetch('/api/v1/orders/track/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: trackOrderIdInput.trim(),
          otp: otpInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTrackingError(data.error || 'OTP verification failed');
      } else {
        setTrackedData(data);
      }
    } catch (err: any) {
      setTrackingError(err.message || 'Failed to verify OTP');
    } finally {
      setTrackingLoading(false);
    }
  };

  useEffect(() => {
    if (portalMode === 'TRACK_ORDER' && trackOrderIdInput && !trackedData) {
      handleRequestTrackingOtp(undefined, trackOrderIdInput);
    }
  }, [portalMode]);

  // Clicking a Public Admin-created product activates a checkout session for that product
  const handleActivateProductCheckout = async (product: any) => {
    setActivatingProductId(product.id);
    setErrorMessage(null);
    setPaymentResult(null);
    try {
      const res = await fetch('/api/v1/checkout/activate-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          sku: product.sku,
          quantity: 1,
          customerName: customerName || 'Guest Customer',
          customerEmail: customerEmail || 'customer@xperiserv.in',
          customerMobile: customerMobile || '+91 98450 11209',
          selectedGateway: selectedGatewayCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Could not activate product checkout');
      } else {
        await onPaymentComplete();
        onSwitchSession(data.checkoutSession.sessionToken);
        setPortalMode('CHECKOUT');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to activate product checkout');
    } finally {
      setActivatingProductId(null);
    }
  };

  const handleApplyCoupon = async () => {
    if (!session || !couponInput.trim()) return;
    setApplyingCoupon(true);
    setCouponMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/checkout/sessions/${session.sessionToken}/coupon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ couponCode: couponInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Coupon could not be applied');
      } else {
        setCouponMessage(
          `Applied ${data.coupon.code}: Saved ${formatINR(data.order.discountAmountPaise)}`
        );
        await onPaymentComplete();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to validate coupon');
    } finally {
      setApplyingCoupon(false);
    }
  };

  // Regular Hosted Session Payment
  const handleExecutePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!acceptedTermsAndPrivacy) {
      setErrorMessage(
        'Please accept the Xperiserv.in Terms & Conditions and Privacy Policy before completing payment.'
      );
      return;
    }
    setProcessing(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/v1/checkout/sessions/${session.sessionToken}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayCode: selectedGatewayCode,
          paymentMethod: 'HOSTED_CHECKOUT',
          instrumentDetail:
            selectedGatewayCode === 'PAYU'
              ? 'PayU India Hosted Checkout'
              : 'Zoho Payments Hosted Checkout',
          simulateOutcome,
          customerName,
          customerEmail,
          customerMobile,
          billingAddress: billingAddressText,
          shippingAddress: shippingAddressText,
          acceptedTermsAndPrivacy,
          acceptedPolicyVersion: XPERISERV_POLICY_VERSION,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Payment verification failed');
      } else {
        setPaymentResult(data);
        setTrackOrderIdInput(data.order?.orderNumber || order?.orderNumber || '');
        await onPaymentComplete();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error while communicating with payment gateway');
    } finally {
      setProcessing(false);
    }
  };

  // Dedicated Private Purchase Link (/pay/{token}) Single-Product Checkout Execution
  const handleExecutePrivateLinkPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateLinkData?.valid) return;
    if (!acceptedTermsAndPrivacy) {
      setErrorMessage(
        'Please accept the Xperiserv.in Terms & Conditions and Privacy Policy before completing payment.'
      );
      return;
    }
    setProcessing(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/v1/pay/${encodeURIComponent(privateLinkToken)}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: privateQuantity,
          customerName,
          customerEmail,
          customerMobile,
          billingAddress: billingAddressText,
          shippingAddress: shippingAddressText,
          couponCode: couponInput.trim() || undefined,
          gatewayCode: selectedGatewayCode,
          simulateOutcome,
          acceptedTermsAndPrivacy: true,
          acceptedPolicyVersion: XPERISERV_POLICY_VERSION,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Private purchase link payment failed');
      } else {
        setPrivatePaymentResult(data);
        setTrackOrderIdInput(data.order?.orderNumber || '');
        await onPaymentComplete();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete private link transaction');
    } finally {
      setProcessing(false);
    }
  };

  const items: CheckoutItem[] = (() => {
    try {
      return JSON.parse(order?.itemsJson || '[]');
    } catch {
      return [];
    }
  })();

  const isAlreadyPaid = session?.status === 'Completed' || order?.paymentStatus === 'Captured';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 Zones */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-md bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm">
            A
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-white block">
              {brandSettings?.companyName || 'Allientic Lab Technologies'}
            </span>
            <span className="text-[11px] font-mono text-slate-400 block">
              checkout.xperiserv.in · Verified Xperiserv.in Policies
            </span>
          </div>
        </div>

        {/* Navigation Links: Switch between Regular Checkout, Private Purchase Link (/pay/token), Public Order Tracker (/track-order), and Policies */}
        <nav className="flex flex-wrap items-center gap-5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setPortalMode('PRIVATE_LINK')}
            className={`transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              portalMode === 'PRIVATE_LINK'
                ? 'text-emerald-400 underline underline-offset-8 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Private Link Checkout (/pay/token)
          </button>
          <button
            type="button"
            onClick={() => setPortalMode('CHECKOUT')}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              portalMode === 'CHECKOUT'
                ? 'text-emerald-400 underline underline-offset-8 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Regular Checkout (/checkout)
          </button>
          <button
            type="button"
            onClick={() => setPortalMode('TRACK_ORDER')}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              portalMode === 'TRACK_ORDER'
                ? 'text-emerald-400 underline underline-offset-8 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Track Order (/track-order)
          </button>
          <button
            type="button"
            onClick={() => setOpenPolicyModalId('ALL')}
            className="text-slate-300 hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            Xperiserv.in Policies
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onBackToAdmin}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Admin Portal
          </button>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* MODE 1: DEDICATED SINGLE-PRODUCT PRIVATE PURCHASE LINK (/pay/:token)  */}
      {/* ===================================================================== */}
      {portalMode === 'PRIVATE_LINK' && (
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-6">
          {/* Private Purchase Link URL Bar & Switcher for Testing Active vs Expired Links */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-semibold shrink-0">
                PRIVATE LINK
              </span>
              <span className="font-mono text-slate-300 truncate">
                https://checkout.xperiserv.in/pay/{privateLinkToken}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400">Switch Demo Purchase Link:</span>
              {(paymentLinks.length > 0
                ? paymentLinks
                : [
                    {
                      linkToken: 'plk_live_bfsi_enclave_9a8f7e6d5c4b3a21',
                      title: 'Active Multi-Use Link',
                      status: 'Active',
                    },
                    {
                      linkToken: 'plk_live_hsm_appliance_4c3b2a1908f7e6d5',
                      title: 'Active Single-Use + Shipping',
                      status: 'Active',
                    },
                    {
                      linkToken: 'plk_expired_legacy_audit_1122334455667788',
                      title: 'Expired Link Demo',
                      status: 'Expired',
                    },
                  ]
              ).map((pl: any) => (
                <button
                  key={pl.linkToken}
                  type="button"
                  onClick={() => setPrivateLinkToken(pl.linkToken)}
                  className={`px-2.5 py-1 rounded-md font-mono text-[11px] border transition-colors ${
                    privateLinkToken === pl.linkToken
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {pl.status === 'Expired' || pl.status === 'Revoked'
                    ? `[${pl.status}] `
                    : ''}
                  {pl.title?.slice(0, 26) || pl.linkToken.slice(0, 16)}
                </button>
              ))}
            </div>
          </div>

          {privateLinkLoading ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-xs text-slate-400">
              Validating cryptographic purchase token with checkout.xperiserv.in...
            </div>
          ) : !privateLinkData?.valid ? (
            /* Professional Expired / Revoked / Unavailable Purchase Link Page */
            <div className="bg-slate-900 border border-rose-900/60 rounded-2xl p-8 max-w-2xl mx-auto text-center space-y-5">
              <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-400 mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-mono uppercase tracking-wider text-rose-400">
                  Link Status: {privateLinkData?.reason || 'UNAVAILABLE'}
                </div>
                <h1 className="text-xl font-bold text-white">
                  Private Purchase Link Unavailable or Expired
                </h1>
                <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                  {privateLinkData?.message ||
                    'This private purchase link has expired, reached its maximum allowed purchase limit, or been revoked by an Allientic Lab Technologies administrator.'}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-1">
                <div>
                  Need a renewed purchase allocation link? Contact{' '}
                  <span className="font-mono text-emerald-400">support@xperiserv.in</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  Token Enumeration &amp; Replay Protection Active · SHA-256 Verified
                </div>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setPrivateLinkToken('plk_live_bfsi_enclave_9a8f7e6d5c4b3a21')
                  }
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                >
                  Open Active Private Link Demo
                </button>
                <button
                  type="button"
                  onClick={() => setPortalMode('TRACK_ORDER')}
                  className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
                >
                  Track Existing Order
                </button>
              </div>
            </div>
          ) : (
            /* Valid Dedicated Single-Product Private Checkout */
            (() => {
              const pProd = privateLinkData.product;
              const pLink = privateLinkData.link;
              const unitPaise = Number(pProd.unitPricePaise || 0);
              const subPaise = unitPaise * privateQuantity;
              const gstPaise = Math.round((subPaise * Number(pProd.taxRatePercent || 18)) / 100);
              const shipPaise = Number(pProd.shippingChargesPaise || 0);
              const finalPayablePaise = subPaise + gstPaise + shipPaise;

              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  {/* Left Column: Exclusive Assigned Private Product Summary (No other catalogue items visible) */}
                  <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                      <div>
                        <span className="text-[11px] font-mono text-emerald-400 uppercase">
                          Dedicated Single-Product Checkout
                        </span>
                        <h2 className="text-base font-bold text-white mt-0.5">{pProd.name}</h2>
                      </div>
                      <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300">
                        {pProd.sku}
                      </span>
                    </div>

                    {pProd.imageUrl && (
                      <div className="rounded-xl overflow-hidden border border-slate-800 h-44 bg-slate-950">
                        <img
                          src={pProd.imageUrl}
                          alt={pProd.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    <p className="text-xs text-slate-300 leading-relaxed">{pProd.description}</p>

                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Unit Price</span>
                        <span className="font-mono font-semibold text-white">
                          {formatINR(unitPaise)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">HSN / SAC Classification</span>
                        <span className="font-mono text-slate-300">{pProd.hsnSacCode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Link Usage Allocation</span>
                        <span className="font-mono text-emerald-400">
                          {pLink.remainingUses} of {pLink.maxPurchases} remaining
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Link Expires</span>
                        <span className="font-mono text-slate-300">
                          {new Date(pLink.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Quantity Selector (if permitted by private product / link) */}
                    {pLink.allowQuantity ? (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                        <span className="text-slate-300 font-medium">
                          Select Quantity (Max {pProd.maxQuantityPerOrder})
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPrivateQuantity((q) => Math.max(1, q - 1))}
                            className="w-7 h-7 rounded bg-slate-950 border border-slate-800 text-white font-bold"
                          >
                            -
                          </button>
                          <span className="font-mono text-sm font-bold text-white w-8 text-center">
                            {privateQuantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPrivateQuantity((q) =>
                                Math.min(pProd.maxQuantityPerOrder || 5, q + 1)
                              )
                            }
                            className="w-7 h-7 rounded bg-slate-950 border border-slate-800 text-white font-bold"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 pt-2 border-t border-slate-800">
                        Quantity fixed to <span className="font-mono text-white">1 unit</span> by
                        administrator link policy.
                      </div>
                    )}

                    {/* Price, GST & Shipping Breakdown */}
                    <div className="space-y-2 pt-3 border-t border-slate-800 text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>Subtotal ({privateQuantity} × {formatINR(unitPaise)})</span>
                        <span className="font-mono text-slate-200">{formatINR(subPaise)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>GST ({pProd.taxRatePercent || 18}%)</span>
                        <span className="font-mono text-slate-200">{formatINR(gstPaise)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Shipping &amp; Insured Handling</span>
                        <span className="font-mono text-slate-200">
                          {shipPaise > 0 ? formatINR(shipPaise) : 'Free Digital / SLA Delivery'}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                        <span>Final Payable Amount</span>
                        <span className="font-mono text-base text-emerald-400">
                          {formatINR(finalPayablePaise)}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Right Column: Private Product Billing, Policy Acceptance & Gateway Payment */}
                  <section className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                    {privatePaymentResult ? (
                      <div className="space-y-6">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                            <div>
                              <h2 className="text-lg font-bold text-white">
                                Private Link Order Confirmed &amp; Verified
                              </h2>
                              <p className="text-xs text-slate-400">
                                Order ID:{' '}
                                <span className="font-mono text-emerald-400 font-semibold">
                                  {privatePaymentResult.order?.orderNumber}
                                </span>{' '}
                                · Policy Accepted: {privatePaymentResult.order?.acceptedPolicyVersion}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setTrackOrderIdInput(privatePaymentResult.order?.orderNumber);
                                setTrackedData(null);
                                setPortalMode('TRACK_ORDER');
                              }}
                              className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"
                            >
                              Track Order
                            </button>
                            <button
                              type="button"
                              onClick={() => window.print()}
                              className="px-3 py-2 text-xs font-medium bg-slate-800 text-slate-200 rounded-lg border border-slate-700"
                            >
                              Download GST Invoice
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-950 border border-slate-800 rounded-lg p-4">
                          <div>
                            <span className="text-slate-500 block">Order ID</span>
                            <span className="font-mono text-emerald-400 font-bold text-sm">
                              {privatePaymentResult.order?.orderNumber}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Gateway Transaction ID</span>
                            <span className="font-mono text-white">
                              {privatePaymentResult.payment?.transactionId}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Accepted Policy Version</span>
                            <span className="font-mono text-slate-200">
                              {privatePaymentResult.order?.acceptedPolicyVersion}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Amount Verified</span>
                            <span className="font-mono text-emerald-400 font-bold">
                              {formatINR(privatePaymentResult.order?.totalAmountPaise)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleExecutePrivateLinkPayment} className="space-y-5">
                        <div className="border-b border-slate-800 pb-4">
                          <h1 className="text-lg font-bold text-white">
                            Complete Private Product Purchase
                          </h1>
                          <p className="text-xs text-slate-400">
                            Restricted to <span className="text-slate-200">{pProd.name}</span> ·
                            Server-side price &amp; signature verification enforced
                          </p>
                        </div>

                        {errorMessage && (
                          <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-lg p-3 text-xs">
                            {errorMessage}
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block text-slate-400 mb-1">Customer Name *</label>
                            <input
                              type="text"
                              required
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-400 mb-1">Email Address *</label>
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
                              type="tel"
                              required
                              value={customerMobile}
                              onChange={(e) => setCustomerMobile(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-400 mb-1">
                              Promo / Partner Coupon (Optional)
                            </label>
                            <input
                              type="text"
                              value={couponInput}
                              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                              placeholder="ALLIENTIC10"
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-slate-400 mb-1">Billing Address *</label>
                            <input
                              type="text"
                              required
                              value={billingAddressText}
                              onChange={(e) => setBillingAddressText(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                            />
                          </div>
                          {shipPaise > 0 && (
                            <div className="sm:col-span-2">
                              <label className="block text-slate-400 mb-1">
                                Shipping Address (Hardware Delivery) *
                              </label>
                              <input
                                type="text"
                                required
                                value={shippingAddressText}
                                onChange={(e) => setShippingAddressText(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                              />
                            </div>
                          )}
                        </div>

                        {/* Payment Gateway Selection: PayU India or Zoho Payments */}
                        <div className="space-y-2">
                          <label className="block text-xs font-semibold text-slate-300">
                            Select Payment Gateway
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {enabledGateways.map((gw) => {
                              const isSelected = selectedGatewayCode === gw.code;
                              return (
                                <button
                                  key={gw.code}
                                  type="button"
                                  onClick={() =>
                                    setSelectedGatewayCode(gw.code as 'PAYU' | 'ZOHO_PAYMENTS')
                                  }
                                  className={`text-left p-3.5 rounded-xl border transition-colors ${
                                    isSelected
                                      ? 'bg-emerald-950/35 border-emerald-500 text-white'
                                      : 'bg-slate-950 border-slate-800 text-slate-300'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white">
                                      {gw.code === 'PAYU' ? 'PayU India' : 'Zoho Payments'}
                                    </span>
                                    <span className="text-[11px] font-mono text-emerald-400">
                                      {isSelected ? 'Selected' : 'Select'}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-400 mt-1">
                                    {gw.code === 'PAYU'
                                      ? 'Official PayU India Hosted Checkout (SHA-512)'
                                      : 'Official Zoho Payments Checkout (HMAC-SHA256)'}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Mandatory Xperiserv.in Terms & Privacy Policy Acceptance Checkbox */}
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs">
                          <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={acceptedTermsAndPrivacy}
                              onChange={(e) => setAcceptedTermsAndPrivacy(e.target.checked)}
                              className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500"
                            />
                            <span className="text-slate-300 leading-relaxed">
                              I accept the{' '}
                              <button
                                type="button"
                                onClick={() => setOpenPolicyModalId('terms-and-conditions')}
                                className="text-emerald-400 hover:underline font-medium"
                              >
                                Terms &amp; Conditions
                              </button>
                              ,{' '}
                              <button
                                type="button"
                                onClick={() => setOpenPolicyModalId('privacy-policy')}
                                className="text-emerald-400 hover:underline font-medium"
                              >
                                Privacy Policy
                              </button>
                              ,{' '}
                              <button
                                type="button"
                                onClick={() => setOpenPolicyModalId('refund-and-cancellation')}
                                className="text-emerald-400 hover:underline font-medium"
                              >
                                Refund &amp; Cancellation Policy
                              </button>
                              , and{' '}
                              <button
                                type="button"
                                onClick={() => setOpenPolicyModalId('payment-terms')}
                                className="text-emerald-400 hover:underline font-medium"
                              >
                                Payment Terms
                              </button>{' '}
                              of <strong>XperiServ Technologies (xperiserv.in)</strong>.
                            </span>
                          </label>
                          <div className="text-[11px] font-mono text-slate-500 pl-6">
                            Audit Record: Policy Version {XPERISERV_POLICY_VERSION} + UTC Timestamp
                            stored with order.
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={processing || !acceptedTermsAndPrivacy}
                          className="w-full py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2"
                        >
                          <Lock className="w-4 h-4" />
                          <span>
                            {processing
                              ? 'Verifying Gateway Signature...'
                              : `Pay ${formatINR(finalPayablePaise)} via ${
                                  selectedGatewayCode === 'PAYU' ? 'PayU India' : 'Zoho Payments'
                                }`}
                          </span>
                        </button>
                      </form>
                    )}
                  </section>
                </div>
              );
            })()
          )}
        </main>
      )}

      {/* ===================================================================== */}
      {/* MODE 2: PUBLIC ORDER TRACKING PAGE (/track-order) WITH OTP SECURITY   */}
      {/* ===================================================================== */}
      {portalMode === 'TRACK_ORDER' && (
        <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <span className="text-[11px] font-mono text-emerald-400">
                  https://checkout.xperiserv.in/track-order
                </span>
                <h1 className="text-lg font-bold text-white">
                  Public Order Tracking &amp; OTP Verification
                </h1>
                <p className="text-xs text-slate-400">
                  Track your order status, courier tracking number, and GST invoice using your Order
                  ID, registered email/mobile, and OTP verification.
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => handleRequestTrackingOtp(e)}
              className="grid grid-cols-1 sm:grid-cols-12 gap-3"
            >
              <div className="sm:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={trackOrderIdInput}
                  onChange={(e) => setTrackOrderIdInput(e.target.value.toUpperCase())}
                  placeholder="Order ID (e.g. ALT-ORD-2026-1001)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-4">
                <input
                  type="text"
                  value={trackContactInput}
                  onChange={(e) => setTrackContactInput(e.target.value)}
                  placeholder="Registered Email or Mobile"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={trackingLoading}
                  className="w-full py-2.5 px-4 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  {trackingLoading ? 'Verifying...' : 'Send OTP & Track'}
                </button>
              </div>
            </form>

            {/* OTP Verification Strip */}
            {otpRequested && (
              <form
                onSubmit={handleVerifyOtpManual}
                className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2 text-slate-300">
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span>
                    Mailgun SMTP OTP dispatched. Sandbox OTP code:{' '}
                    <strong className="font-mono text-emerald-400">{sandboxOtpPreview}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="6-digit OTP"
                    className="w-28 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white text-center"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-emerald-600 text-white font-semibold rounded hover:bg-emerald-500"
                  >
                    Verify OTP
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Sample Order IDs:</span>
              {['ALT-ORD-2026-1001', 'ALT-ORD-2026-1002', 'ALT-ORD-2026-1003'].map((sampleId) => (
                <button
                  key={sampleId}
                  type="button"
                  onClick={() => {
                    setTrackOrderIdInput(sampleId);
                    handleRequestTrackingOtp(undefined, sampleId);
                  }}
                  className="font-mono text-emerald-400 hover:underline"
                >
                  {sampleId}
                </button>
              ))}
            </div>
          </div>

          {trackingError && (
            <div className="bg-rose-950/50 border border-rose-800 text-rose-200 rounded-xl p-4 text-xs">
              {trackingError}
            </div>
          )}

          {trackedData?.order && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Order ID</span>
                    {trackedData.order.isPrivateLinkOrder && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300">
                        Private Link Order
                      </span>
                    )}
                  </div>
                  <div className="text-xl font-bold font-mono text-white">
                    {trackedData.order.orderNumber}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Customer: <span className="text-slate-200">{trackedData.order.customerName}</span>{' '}
                    · <span className="font-mono">{trackedData.order.customerEmail}</span> · Order
                    Date: {new Date(trackedData.order.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {trackedData.checkoutSession &&
                    trackedData.order.paymentStatus !== 'Captured' &&
                    trackedData.order.paymentStatus !== 'Partially Refunded' && (
                      <button
                        type="button"
                        onClick={() => {
                          onSwitchSession(trackedData.checkoutSession.sessionToken);
                          setPortalMode('CHECKOUT');
                        }}
                        className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                      >
                        Retry / Complete Payment
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Download GST Invoice PDF
                  </button>
                </div>
              </div>

              {/* Status Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5">
                  <span className="text-slate-500 block">Order / Processing Status</span>
                  <span className="text-sm font-bold text-white mt-0.5 block">
                    {trackedData.order.orderStatus}
                  </span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5">
                  <span className="text-slate-500 block">Payment Status</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono mt-0.5 block">
                    {trackedData.order.paymentStatus}
                  </span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5">
                  <span className="text-slate-500 block">Shipping / Fulfillment</span>
                  <span className="text-sm font-bold text-slate-200 mt-0.5 block">
                    {trackedData.order.fulfillmentStatus}
                  </span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5">
                  <span className="text-slate-500 block">Total Amount</span>
                  <span className="text-sm font-bold text-white font-mono tabular-nums mt-0.5 block">
                    {formatINR(trackedData.order.totalAmountPaise)}
                  </span>
                </div>
              </div>

              {/* Shipping Tracking & Accepted Policy Audit */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-slate-500 block">Courier Tracking &amp; ETA</span>
                    <span className="font-mono text-slate-200 font-medium">
                      {trackedData.order.shippingTrackingNumber || 'Digital SLA / Instant Delivery'}
                    </span>
                    {trackedData.order.estimatedDeliveryDate && (
                      <span className="block text-[11px] text-emerald-400">
                        Estimated Delivery: {trackedData.order.estimatedDeliveryDate}
                      </span>
                    )}
                  </div>
                  <Truck className="w-4 h-4 text-slate-500" />
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5">
                  <span className="text-slate-500 block">Accepted Xperiserv.in Policy Audit</span>
                  <span className="font-mono text-emerald-400 font-medium">
                    {trackedData.order.acceptedPolicyVersion || XPERISERV_POLICY_VERSION}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    Timestamp:{' '}
                    {new Date(
                      trackedData.order.acceptedPolicyTimestamp || trackedData.order.createdAt
                    ).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">Product Purchased</h3>
                <div className="bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800 text-xs">
                  {(() => {
                    try {
                      return JSON.parse(trackedData.order.itemsJson || '[]');
                    } catch {
                      return [];
                    }
                  })().map((item: any, idx: number) => (
                    <div key={idx} className="p-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-white">{item.name}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          SKU: {item.sku} · Qty: {item.quantity}
                        </div>
                      </div>
                      <div className="font-mono tabular-nums text-slate-200 font-semibold">
                        {formatINR(item.unitPricePaise * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Activity Timeline */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">Order Activity Timeline</h3>
                <div className="space-y-2">
                  {(() => {
                    try {
                      return JSON.parse(trackedData.order.timelineJson || '[]');
                    } catch {
                      return [];
                    }
                  })().map((ev: any, idx: number) => (
                    <div
                      key={idx}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-start justify-between gap-4 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-200">{ev.action}</div>
                        <div className="text-slate-400 mt-0.5">{ev.note}</div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0">
                        {new Date(ev.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* ===================================================================== */}
      {/* MODE 3: REGULAR PUBLIC CHECKOUT (PRIVATE PRODUCTS NEVER SHOWN HERE)    */}
      {/* ===================================================================== */}
      {portalMode === 'CHECKOUT' && (
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
          {/* Public Admin-Created Products Bar (Private Products Strictly Excluded) */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" />
                  Public Catalogue Products (Private Products Hidden &amp; Restricted to /pay/token)
                </h2>
                <p className="text-xs text-slate-400">
                  Click any public product below to activate a guest checkout session
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setPortalMode('PRIVATE_LINK')}
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                >
                  Have a Private Purchase Link? Open /pay/token
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {publicProductsOnly.map((prd: any) => {
                const isCurrentProduct = items.some((i) => i.sku === prd.sku);
                const isActivating = activatingProductId === prd.id;
                return (
                  <button
                    key={prd.id}
                    type="button"
                    disabled={isActivating}
                    onClick={() => handleActivateProductCheckout(prd)}
                    className={`text-left p-4 rounded-xl border transition-colors flex flex-col justify-between gap-3 ${
                      isCurrentProduct
                        ? 'bg-emerald-950/25 border-emerald-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>{prd.sku}</span>
                        {isCurrentProduct && (
                          <span className="text-emerald-400 font-semibold">Active</span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-white line-clamp-2">{prd.name}</div>
                      <p className="text-[11px] text-slate-400 line-clamp-2">{prd.description}</p>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="font-mono tabular-nums text-sm font-bold text-emerald-400">
                        {formatINR(prd.unitPricePaise)}
                      </span>
                      <span className="text-[11px] font-medium text-slate-300">
                        {isActivating ? 'Activating...' : 'Click to Checkout →'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Active Checkout Session Grid */}
          {session && order && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Active Product & Order Summary */}
              <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                <div className="space-y-1 border-b border-slate-800 pb-5">
                  <div className="text-xs text-slate-400 flex items-center justify-between">
                    <span>Order ID (Use to Track Order)</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(order.orderNumber);
                        setCopiedOrderId(true);
                        setTimeout(() => setCopiedOrderId(false), 1800);
                      }}
                      className="flex items-center gap-1 font-mono text-emerald-400 hover:underline"
                    >
                      <span>{order.orderNumber}</span>
                      {copiedOrderId ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <div className="text-3xl font-bold font-mono tabular-nums text-white pt-1">
                    {formatINR(order.totalAmountPaise)}
                  </div>
                  <p className="text-xs text-slate-400">
                    Includes 18% GST · Currency: {order.currency}
                  </p>
                </div>

                {/* Selected Product Breakdown */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-300">Selected Product Summary</h3>
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-800/70 text-sm"
                    >
                      <div className="space-y-0.5">
                        <div className="font-medium text-slate-100">{item.name}</div>
                        <div className="text-xs text-slate-400">
                          SKU: <span className="font-mono">{item.sku}</span> · Qty: {item.quantity}{' '}
                          · GST: {item.taxRatePercent}%
                        </div>
                        <p className="text-xs text-slate-500">{item.description}</p>
                      </div>
                      <div className="font-mono tabular-nums text-sm font-medium text-slate-200 shrink-0">
                        {formatINR(item.unitPricePaise * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Coupon Code */}
                {!isAlreadyPaid && (
                  <div className="space-y-2 pt-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Coupon Code (Optional)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="ALLIENTIC10 or XPERISERV2500"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCoupon}
                        disabled={applyingCoupon}
                        className="px-4 py-2 text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                      >
                        {applyingCoupon ? 'Applying...' : 'Apply'}
                      </button>
                    </div>
                    {couponMessage && <p className="text-xs text-emerald-400">{couponMessage}</p>}
                  </div>
                )}

                {/* Tax & Total Breakdown */}
                <div className="space-y-2.5 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {formatINR(order.subtotalPaise)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Tax (GST 18%)</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {formatINR(order.taxAmountPaise)}
                    </span>
                  </div>
                  {order.shippingChargesPaise > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>Shipping Charges</span>
                      <span className="font-mono tabular-nums text-slate-200">
                        {formatINR(order.shippingChargesPaise)}
                      </span>
                    </div>
                  )}
                  {order.discountAmountPaise > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Discount ({order.couponCode || 'Promo'})</span>
                      <span className="font-mono tabular-nums">
                        -{formatINR(order.discountAmountPaise)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold text-white pt-2 border-t border-slate-800">
                    <span>Total Payable</span>
                    <span className="font-mono tabular-nums text-base text-emerald-400">
                      {formatINR(order.totalAmountPaise)}
                    </span>
                  </div>
                </div>
              </section>

              {/* Right Column: Guest Checkout + Mandatory Xperiserv.in Policy Acceptance */}
              <section className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                {paymentResult || isAlreadyPaid ? (
                  <div className="space-y-6">
                    {(() => {
                      const status = paymentResult?.payment?.status || order.paymentStatus;
                      const isSuccess =
                        status === 'Captured' ||
                        status === 'Paid' ||
                        status === 'Partially Refunded';
                      const isPending = status === 'Pending';

                      return (
                        <>
                          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5">
                            <div className="flex items-center gap-3">
                              {isSuccess ? (
                                <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                              ) : isPending ? (
                                <Clock className="w-8 h-8 text-amber-400 shrink-0" />
                              ) : (
                                <XCircle className="w-8 h-8 text-rose-400 shrink-0" />
                              )}
                              <div>
                                <h2 className="text-lg font-bold text-white">
                                  {isSuccess
                                    ? 'Payment Verified & Order Confirmed'
                                    : isPending
                                      ? 'Payment Pending Confirmation'
                                      : 'Payment Authorization Failed'}
                                </h2>
                                <p className="text-xs text-slate-400">
                                  Order ID:{' '}
                                  <span className="font-mono text-emerald-400 font-semibold">
                                    {order.orderNumber}
                                  </span>{' '}
                                  · Accepted Policy: {order.acceptedPolicyVersion || XPERISERV_POLICY_VERSION}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setTrackOrderIdInput(order.orderNumber);
                                  setPortalMode('TRACK_ORDER');
                                }}
                                className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 whitespace-nowrap"
                              >
                                Track Order Status
                              </button>
                              <button
                                type="button"
                                onClick={() => window.print()}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-700 whitespace-nowrap"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Invoice PDF
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-950 border border-slate-800 rounded-lg p-4">
                            <div>
                              <span className="text-slate-500 block">Order ID (For Tracking)</span>
                              <span className="font-mono text-emerald-400 font-bold text-sm">
                                {order.orderNumber}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Transaction ID</span>
                              <span className="font-mono text-slate-100 font-medium">
                                {paymentResult?.payment?.transactionId || 'TXN-ALT-VERIFIED'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Payment Gateway</span>
                              <span className="font-mono text-slate-100">
                                {paymentResult?.payment?.gatewayCode ||
                                  session.selectedGateway ||
                                  selectedGatewayCode}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Accepted Policy Version</span>
                              <span className="font-mono text-emerald-400">
                                {order.acceptedPolicyVersion || XPERISERV_POLICY_VERSION}
                              </span>
                            </div>
                          </div>

                          {!isSuccess && (
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentResult(null);
                                  setSimulateOutcome('SUCCESS');
                                }}
                                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Retry Payment
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <form onSubmit={handleExecutePayment} className="space-y-5">
                    <div className="border-b border-slate-800 pb-4 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h1 className="text-lg font-bold text-white">
                          Guest Checkout (No Account Required)
                        </h1>
                        <p className="text-xs text-slate-400">
                          Enter contact details for Mailgun SMTP receipt &amp; choose PayU India or
                          Zoho Payments
                        </p>
                      </div>
                      <div className="text-xs font-mono text-slate-400">
                        Order ID: <span className="text-white">{order.orderNumber}</span>
                      </div>
                    </div>

                    {errorMessage && (
                      <div className="bg-rose-950/50 border border-rose-800/80 text-rose-200 rounded-lg p-3.5 text-xs flex items-center justify-between">
                        <span>{errorMessage}</span>
                        <button
                          type="button"
                          onClick={() => setErrorMessage(null)}
                          className="text-rose-400 hover:text-white font-medium ml-4"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}

                    {/* Step 1: Guest Contact Details */}
                    <div className="space-y-3">
                      <h2 className="text-xs font-semibold text-slate-300">
                        1. Customer Contact &amp; Billing Details
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Full Name *</label>
                          <input
                            type="text"
                            required
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Email Address (For Order ID &amp; Receipt) *
                          </label>
                          <input
                            type="email"
                            required
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Mobile Number *
                          </label>
                          <input
                            type="tel"
                            required
                            value={customerMobile}
                            onChange={(e) => setCustomerMobile(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Billing Address
                          </label>
                          <input
                            type="text"
                            value={billingAddressText}
                            onChange={(e) => setBillingAddressText(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Step 2: Single Customer Choice — PayU India OR Zoho Payments */}
                    <div className="space-y-3">
                      <h2 className="text-xs font-semibold text-slate-300">
                        2. Select Payment Gateway (PayU India or Zoho Payments)
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {enabledGateways.map((gw) => {
                          const isSelected = selectedGatewayCode === gw.code;
                          return (
                            <button
                              key={gw.code}
                              type="button"
                              onClick={() =>
                                setSelectedGatewayCode(gw.code as 'PAYU' | 'ZOHO_PAYMENTS')
                              }
                              className={`text-left p-4 rounded-xl border transition-colors ${
                                isSelected
                                  ? 'bg-emerald-950/35 border-emerald-500 text-white'
                                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-white">
                                  {gw.code === 'PAYU' ? 'PayU India' : 'Zoho Payments'}
                                </span>
                                <span className="text-xs font-mono text-emerald-400">
                                  {isSelected ? 'Selected' : 'Select'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-1">
                                {gw.code === 'PAYU'
                                  ? 'Official PayU India Hosted Checkout (SHA-512 Verified)'
                                  : 'Official Zoho Payments Hosted Checkout (HMAC-SHA256 Verified)'}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Step 3: Mandatory Xperiserv.in Terms & Policies Acceptance */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acceptedTermsAndPrivacy}
                          onChange={(e) => setAcceptedTermsAndPrivacy(e.target.checked)}
                          className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className="text-slate-300 leading-relaxed">
                          I have read and accept the official{' '}
                          <button
                            type="button"
                            onClick={() => setOpenPolicyModalId('terms-and-conditions')}
                            className="text-emerald-400 hover:underline font-medium"
                          >
                            Terms &amp; Conditions
                          </button>
                          ,{' '}
                          <button
                            type="button"
                            onClick={() => setOpenPolicyModalId('privacy-policy')}
                            className="text-emerald-400 hover:underline font-medium"
                          >
                            Privacy Policy
                          </button>
                          ,{' '}
                          <button
                            type="button"
                            onClick={() => setOpenPolicyModalId('refund-and-cancellation')}
                            className="text-emerald-400 hover:underline font-medium"
                          >
                            Refund &amp; Cancellation Policy
                          </button>
                          , and{' '}
                          <button
                            type="button"
                            onClick={() => setOpenPolicyModalId('shipping-and-delivery')}
                            className="text-emerald-400 hover:underline font-medium"
                          >
                            Shipping &amp; Delivery Policy
                          </button>{' '}
                          of <strong>XperiServ Technologies (xperiserv.in)</strong>.
                        </span>
                      </label>
                      <div className="text-[11px] font-mono text-slate-500 pl-6">
                        Policy Version: {XPERISERV_POLICY_VERSION} · Stored with order for audit
                        compliance
                      </div>
                    </div>

                    {/* Sandbox Verification Outcome Selector */}
                    <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <span className="text-slate-400">Gateway Callback Verification Mode:</span>
                      <div className="flex items-center gap-2">
                        {(['SUCCESS', 'PENDING', 'FAILURE'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setSimulateOutcome(mode)}
                            className={`px-2.5 py-1 rounded font-mono text-[11px] border ${
                              simulateOutcome === mode
                                ? 'bg-slate-800 text-white border-slate-600'
                                : 'bg-slate-950 text-slate-400 border-slate-800'
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={processing || !acceptedTermsAndPrivacy}
                      className="w-full py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <Lock className="w-4 h-4" />
                      <span>
                        {processing
                          ? 'Verifying Gateway Hash...'
                          : `Pay ${formatINR(order.totalAmountPaise)} with ${
                              selectedGatewayCode === 'PAYU' ? 'PayU India' : 'Zoho Payments'
                            }`}
                      </span>
                    </button>
                  </form>
                )}
              </section>
            </div>
          )}
        </main>
      )}

      {/* Official Xperiserv.in Policy Footer on All Customer-Facing Pages */}
      <XperiservPolicyFooter />

      {openPolicyModalId && (
        <XperiservPolicyModal
          initialPolicyId={openPolicyModalId}
          onClose={() => setOpenPolicyModalId(null)}
        />
      )}
    </div>
  );
};
