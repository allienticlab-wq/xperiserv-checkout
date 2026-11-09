import React, { useState } from 'react';
import {
  XPERISERV_POLICIES,
  XPERISERV_POLICY_VERSION,
  XperiservPolicy,
} from '../data/xperiservPolicies.ts';
import {
  ShieldCheck,
  ExternalLink,
  FileText,
  X,
  Building2,
  Mail,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface XperiservPolicyFooterProps {
  compact?: boolean;
  onOpenPolicyId?: (policyId: XperiservPolicy['id']) => void;
}

export const XperiservPolicyModal: React.FC<{
  initialPolicyId?: XperiservPolicy['id'] | 'ALL';
  onClose: () => void;
}> = ({ initialPolicyId = 'ALL', onClose }) => {
  const [selectedTab, setSelectedTab] = useState<XperiservPolicy['id'] | 'ALL'>(initialPolicyId);

  const displayedPolicies =
    selectedTab === 'ALL'
      ? XPERISERV_POLICIES
      : XPERISERV_POLICIES.filter((p) => p.id === selectedTab);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                XperiServ Technologies (xperiserv.in) — Official Legal &amp; Business Policies
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Policy Version: {XPERISERV_POLICY_VERSION} · Verified Domain: https://xperiserv.in
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Policy Selector Tabs */}
        <div className="px-6 py-2.5 border-b border-slate-800 bg-slate-900 flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedTab('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              selectedTab === 'ALL'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            All 7 Policies
          </button>
          {XPERISERV_POLICIES.map((pol) => (
            <button
              key={pol.id}
              type="button"
              onClick={() => setSelectedTab(pol.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedTab === pol.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {pol.shortLabel}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs">
          {displayedPolicies.map((pol) => (
            <div
              key={pol.id}
              className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                    <h3 className="text-sm font-bold text-white">{pol.title}</h3>
                  </div>
                  <p className="text-slate-400 mt-1">{pol.summary}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[11px] text-slate-400 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
                    {pol.version}
                  </span>
                  <a
                    href={pol.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/25 font-medium"
                  >
                    <span>xperiserv.in</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pol.sections.map((sec, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-3.5 space-y-1.5"
                  >
                    <div className="font-semibold text-slate-100">{sec.heading}</div>
                    <p className="text-slate-400 leading-relaxed">{sec.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>
              XperiServ Technologies · Beside of Kathajodi River, Samsundarpur, Gopalpur, Cuttack
              Sadar, Odisha — 753011 · support@xperiserv.in
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg"
          >
            Close Policy Viewer
          </button>
        </div>
      </div>
    </div>
  );
};

export const XperiservPolicyFooter: React.FC<XperiservPolicyFooterProps> = ({ compact = false }) => {
  const [modalPolicyId, setModalPolicyId] = useState<XperiservPolicy['id'] | 'ALL' | null>(null);

  return (
    <>
      <footer className="border-t border-slate-800 bg-slate-900/75 text-slate-400">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
          {!compact && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-slate-800/80 text-xs">
              <div className="space-y-1">
                <div className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                  Allientic Lab Technologies &amp; XperiServ Technologies
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Beside of Kathajodi River, Samsundarpur, Gopalpur, Cuttack Sadar, Odisha, India —
                  753011
                </p>
              </div>
              <div className="space-y-1">
                <div className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-emerald-400" />
                  Official Support &amp; Grievance Desk
                </div>
                <p className="text-slate-400">
                  Email: <span className="font-mono text-slate-200">support@xperiserv.in</span> ·
                  Web:{' '}
                  <a
                    href="https://xperiserv.in"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline font-mono"
                  >
                    https://xperiserv.in
                  </a>
                </p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Support Hours: Mon–Fri, 9:00 AM – 6:00 PM IST
                </p>
              </div>
              <div className="space-y-1 md:text-right">
                <div className="font-bold text-slate-200">Verified Policy Integration</div>
                <p className="text-[11px] font-mono text-emerald-400">
                  Version: {XPERISERV_POLICY_VERSION}
                </p>
                <button
                  type="button"
                  onClick={() => setModalPolicyId('ALL')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg mt-1"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  Read All Xperiserv.in Policies
                </button>
              </div>
            </div>
          )}

          {/* All 7 Required Xperiserv.in Policy Links */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {XPERISERV_POLICIES.map((pol) => (
                <span key={pol.id} className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setModalPolicyId(pol.id)}
                    className="text-slate-300 hover:text-emerald-400 hover:underline font-medium transition-colors"
                  >
                    {pol.shortLabel}
                  </button>
                  <a
                    href={pol.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${pol.url}`}
                    className="text-slate-500 hover:text-emerald-400"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </span>
              ))}
            </div>
            <div className="text-[11px] text-slate-500 font-mono">
              © {new Date().getFullYear()} Allientic Lab Technologies · Powered by XperiServ
              Technologies (xperiserv.in)
            </div>
          </div>
        </div>
      </footer>

      {modalPolicyId && (
        <XperiservPolicyModal
          initialPolicyId={modalPolicyId}
          onClose={() => setModalPolicyId(null)}
        />
      )}
    </>
  );
};
