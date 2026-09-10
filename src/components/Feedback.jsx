import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite } from '../utils/appContextHelpers';
import {
  Mail,
  Phone,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Building2,
  HelpCircle,
  Clock,
  Sparkles,
  MessageCircle
} from 'lucide-react';

const DEVELOPER_CONTACT = {
  name: 'Zhon Manaois',
  role: 'Lead Systems Developer',
  email: 'zhon.manaois@mobilecareph.com',
  viber: '09763543574',
  viberLink: 'viber://chat?number=%2B639763543574',
  telLink: 'tel:09763543574'
};

export default function Feedback() {
  const { currentUser, sites = [], showToast } = useApp();

  const userSite = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [sites, currentUser]);

  const [copyEmailSuccess, setCopyEmailSuccess] = useState(false);
  const [copyViberSuccess, setCopyViberSuccess] = useState(false);

  const handleCopy = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'email') {
      setCopyEmailSuccess(true);
      setTimeout(() => setCopyEmailSuccess(false), 2000);
      showToast('Developer email copied to clipboard', 'success');
    } else {
      setCopyViberSuccess(true);
      setTimeout(() => setCopyViberSuccess(false), 2000);
      showToast('Developer phone / Viber number copied to clipboard', 'success');
    }
  };

  return (
    <div className="feedback-page-container" style={{ maxWidth: '1000px', margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Hero Banner */}
      <div
        className="card"
        style={{
          marginBottom: '24px',
          background: 'linear-gradient(135deg, #090f1d 0%, #0f172a 45%, #1e293b 100%)',
          color: '#ffffff',
          padding: '28px 32px',
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.25)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8' }}>
                <Phone size={20} />
              </div>
              <h2 style={{ color: '#fff', fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                Developer Direct Contact &amp; Support
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Building2 size={13} />
                {userSite.name} ({userSite.code})
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13.5px', margin: 0, lineHeight: 1.5, maxWidth: '640px' }}>
              For any system issues, questions, or branch operational concerns, reach out directly to the developer using the contact details below.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.25)', padding: '5px 12px', borderRadius: '8px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={15} /> Direct Developer Support
            </span>
          </div>
        </div>
      </div>

      {/* 2. Direct Contact Cards (Prominent & Clean) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        
        {/* Email Card */}
        <div
          className="card"
          style={{
            padding: '24px',
            borderRadius: '14px',
            border: '1.5px solid #bae6fd',
            background: 'linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%)',
            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '18px'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#0284c7', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mail size={22} />
              </div>
              <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '6px' }}>
                Email Support
              </span>
            </div>

            <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Developer Email
            </div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '4px 0 8px', wordBreak: 'break-all' }}>
              {DEVELOPER_CONTACT.email}
            </div>
            <p style={{ margin: 0, fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>
              Send bug reports, detailed descriptions, screenshots, or general inquiries directly to this address.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleCopy(DEVELOPER_CONTACT.email, 'email')}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '9px 14px', borderRadius: '8px', fontWeight: 700 }}
              title="Copy Email Address"
            >
              {copyEmailSuccess ? <Check size={15} color="#059669" /> : <Copy size={15} />}
              <span>{copyEmailSuccess ? 'Copied to Clipboard' : 'Copy Email'}</span>
            </button>
            <a
              href={`mailto:${DEVELOPER_CONTACT.email}?subject=%5BMDC%20System%20Feedback%20-%20${encodeURIComponent(userSite.code)}%5D`}
              className="btn btn-primary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '9px 14px', background: '#0284c7', textDecoration: 'none', borderRadius: '8px', fontWeight: 700 }}
              title="Open Default Email Client"
            >
              <ExternalLink size={15} />
              <span>Send Email</span>
            </a>
          </div>
        </div>

        {/* Viber & Phone Card */}
        <div
          className="card"
          style={{
            padding: '24px',
            borderRadius: '14px',
            border: '1.5px solid #ddd6fe',
            background: 'linear-gradient(180deg, #f5f3ff 0%, #ffffff 100%)',
            boxShadow: '0 4px 12px rgba(124, 58, 237, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '18px'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#7c3aed', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Phone size={22} />
              </div>
              <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#ede9fe', color: '#6d28d9', padding: '3px 8px', borderRadius: '6px' }}>
                Viber &amp; Phone
              </span>
            </div>

            <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Developer Viber / Phone
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '4px 0 8px', fontFamily: 'var(--font-mono)' }}>
              {DEVELOPER_CONTACT.viber}
            </div>
            <p style={{ margin: 0, fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>
              For urgent operational blockers or real-time assistance during branch hours, message or call directly on Viber.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleCopy(DEVELOPER_CONTACT.viber, 'viber')}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '9px 14px', borderRadius: '8px', fontWeight: 700 }}
              title="Copy Viber Number"
            >
              {copyViberSuccess ? <Check size={15} color="#059669" /> : <Copy size={15} />}
              <span>{copyViberSuccess ? 'Copied to Clipboard' : 'Copy Number'}</span>
            </button>
            <a
              href={DEVELOPER_CONTACT.viberLink}
              className="btn btn-primary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '9px 14px', background: '#7c3aed', borderColor: '#7c3aed', textDecoration: 'none', borderRadius: '8px', fontWeight: 700 }}
              title="Open Viber App"
            >
              <MessageCircle size={15} />
              <span>Open Viber</span>
            </a>
          </div>
        </div>
      </div>

      {/* 3. Helpful Contact Notice / Quick Tips */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <Sparkles size={16} color="#0284c7" />
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            When Contacting Support
          </h4>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: '#475569', lineHeight: 1.5 }}>
          To help resolve your issue as quickly as possible, please include:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            📍 <strong>Your Branch:</strong> {userSite.name} ({userSite.code})
          </div>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            🏷️ <strong>Reference:</strong> Part Number, Serial #, or Request ID
          </div>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            📸 <strong>Screenshots:</strong> Take a photo or screenshot of the screen/error
          </div>
        </div>
      </div>
    </div>
  );
}
