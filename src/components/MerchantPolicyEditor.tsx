import React, { useState, useEffect } from 'react';
import {
  XPERISERV_POLICIES,
  XPERISERV_POLICY_VERSION,
  XperiservPolicy,
} from '../data/xperiservPolicies.ts';
import {
  Scale,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Eye,
  AlertCircle,
} from 'lucide-react';
import { XperiservPolicyModal } from './XperiservPolicyFooter.tsx';

interface MerchantPolicyEditorProps {
  showToast: (msg: string) => void;
  onSaved?: () => void;
}

export const MerchantPolicyEditor: React.FC<MerchantPolicyEditorProps> = ({
  showToast,
  onSaved,
}) => {
  const [policies, setPolicies] = useState<XperiservPolicy[]>(XPERISERV_POLICIES);
  const [activePolicyId, setActivePolicyId] = useState<XperiservPolicy['id']>('privacy-policy');
  const [policyVersion, setPolicyVersion] = useState<string>(XPERISERV_POLICY_VERSION);
  const [domain, setDomain] = useState<string>('https://xperiserv.in');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [previewPolicyId, setPreviewPolicyId] = useState<XperiservPolicy['id'] | null>(null);

  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/policies');
      const data = await res.json();
      if (data?.policies && Array.isArray(data.policies)) {
        setPolicies(data.policies);
        if (data.version) setPolicyVersion(data.version);
        if (data.domain) setDomain(data.domain);
      }
    } catch {
      showToast('Could not fetch custom policies, using defaults');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const activePolicyIndex = policies.findIndex((p) => p.id === activePolicyId);
  const currentPolicy = policies[activePolicyIndex] || policies[0];

  const updateCurrentPolicy = (patch: Partial<XperiservPolicy>) => {
    setPolicies((prev) => {
      const updated = [...prev];
      if (activePolicyIndex >= 0) {
        updated[activePolicyIndex] = { ...updated[activePolicyIndex], ...patch };
      }
      return updated;
    });
  };

  const handleUpdateSection = (secIndex: number, field: 'heading' | 'body', value: string) => {
    if (!currentPolicy) return;
    const newSections = [...currentPolicy.sections];
    newSections[secIndex] = { ...newSections[secIndex], [field]: value };
    updateCurrentPolicy({ sections: newSections });
  };

  const handleAddSection = () => {
    if (!currentPolicy) return;
    const newSections = [
      ...currentPolicy.sections,
      {
        heading: `${currentPolicy.sections.length + 1}. New Policy Clause`,
        body: 'Describe the policy terms, legal stipulations, and customer obligations here.',
      },
    ];
    updateCurrentPolicy({ sections: newSections });
    showToast('Added new clause');
  };

  const handleRemoveSection = (secIndex: number) => {
    if (!currentPolicy || currentPolicy.sections.length <= 1) {
      showToast('A policy must contain at least one clause');
      return;
    }
    const newSections = currentPolicy.sections.filter((_, idx) => idx !== secIndex);
    updateCurrentPolicy({ sections: newSections });
    showToast('Removed clause');
  };

  const handleSavePolicies = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: policyVersion,
          domain,
          policies,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Merchant policies saved & published successfully');
        if (onSaved) onSaved();
      } else {
        showToast(data.error || 'Failed to update policies');
      }
    } catch {
      showToast('Failed to save merchant policies');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = () => {
    if (!window.confirm('Reset all policies to standard canonical XperiServ defaults?')) {
      return;
    }
    setPolicies(XPERISERV_POLICIES);
    setPolicyVersion(XPERISERV_POLICY_VERSION);
    showToast('Reset to canonical defaults. Click "Save & Publish" to commit changes.');
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
        Loading merchant legal policies...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">
              Merchant Legal &amp; Policy Customizer
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono">
              Live Checkout Sync Active
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Edit and publish merchant policy terms (Privacy, Terms of Service, Cancellation &amp; Refund, Shipping, Contact, Payment Terms, Disclaimer).
            Changes are saved to PostgreSQL and immediately reflected in customer checkout modals and receipts.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={() => setPreviewPolicyId(activePolicyId)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-sky-300 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 rounded-lg transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Live Preview
          </button>
          <button
            type="button"
            onClick={handleSavePolicies}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50 shadow-lg shadow-emerald-950"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Publishing...' : 'Save & Publish Policies'}
          </button>
        </div>
      </div>

      {/* Policy Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {policies.map((pol) => (
          <button
            key={pol.id}
            type="button"
            onClick={() => setActivePolicyId(pol.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activePolicyId === pol.id
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            {pol.shortLabel}
          </button>
        ))}
      </div>

      {/* Active Policy Editor Workspace */}
      {currentPolicy && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Metadata & Core Parameters */}
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 text-xs">
            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3 flex items-center justify-between">
              <span>Policy Properties</span>
              <span className="font-mono text-[11px] text-emerald-400">{currentPolicy.id}</span>
            </h3>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Display Title</label>
              <input
                type="text"
                value={currentPolicy.title}
                onChange={(e) => updateCurrentPolicy({ title: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-medium focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Short Tab Label</label>
              <input
                type="text"
                value={currentPolicy.shortLabel}
                onChange={(e) => updateCurrentPolicy({ shortLabel: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-medium focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Effective Date</label>
              <input
                type="text"
                value={currentPolicy.effectiveDate}
                onChange={(e) => updateCurrentPolicy({ effectiveDate: e.target.value })}
                placeholder="e.g. 01 November 2026"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Canonical Web URL</label>
              <input
                type="text"
                value={currentPolicy.url}
                onChange={(e) => updateCurrentPolicy({ url: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-[11px] focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Global Policy Version</label>
              <input
                type="text"
                value={policyVersion}
                onChange={(e) => setPolicyVersion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-[11px] focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Executive Summary</label>
              <textarea
                rows={4}
                value={currentPolicy.summary}
                onChange={(e) => updateCurrentPolicy({ summary: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs leading-relaxed focus:border-emerald-500 resize-none"
              />
            </div>
          </div>

          {/* Right Column: Clauses & Sections Editor */}
          <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Clauses &amp; Policy Sections ({currentPolicy.sections.length})
                </h3>
                <p className="text-[11px] text-slate-400">
                  Each numbered clause will be presented to customers during checkout and legal review.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddSection}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 rounded-lg hover:bg-emerald-600/30 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Clause
              </button>
            </div>

            <div className="space-y-4">
              {currentPolicy.sections.map((section, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center font-mono font-bold text-slate-400 text-[11px] shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={section.heading}
                      onChange={(e) => handleUpdateSection(idx, 'heading', e.target.value)}
                      placeholder="Clause Heading (e.g. 1. Refund Settlement Timeline)"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-white font-semibold focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveSection(idx)}
                      title="Delete Clause"
                      className="p-1.5 rounded-lg bg-rose-950/40 text-rose-400 border border-rose-900/40 hover:bg-rose-900/50 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div>
                    <textarea
                      rows={3}
                      value={section.body}
                      onChange={(e) => handleUpdateSection(idx, 'body', e.target.value)}
                      placeholder="Clause body and legal details..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs leading-relaxed focus:border-emerald-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Synchronized with DPDP Act 2023, IT Rules, and PCI-DSS compliance</span>
              </div>
              <button
                type="button"
                onClick={handleSavePolicies}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Publishing...' : 'Save & Publish Policies'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Live Preview */}
      {previewPolicyId && (
        <XperiservPolicyModal
          initialPolicyId={previewPolicyId}
          policies={policies}
          version={policyVersion}
          onClose={() => setPreviewPolicyId(null)}
        />
      )}
    </div>
  );
};
