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
  Sparkles,
  MessageCircle,
  Users,
  Boxes,
  Code
} from 'lucide-react';

const SUPPORT_CONTACTS = [
  {
    id: 'joshua',
    name: 'Joshua Juvida',
    role: 'Inventory Planner / MDC Operations',
    focusTitle: 'For MDC Concerns',
    badge: 'MDC Concerns',
    initials: 'JJ',
    tagColor: '#0284c7',
    tagBg: '#e0f2fe',
    tagBorder: '#bae6fd',
    accentColor: '#0284c7',
    icon: Boxes,
    scopeDescription: 'Contact Joshua primarily for MDC branch concerns, parts allocations, replenishment, inventory availability, and requisitions.',
    email: 'joshua.juvida@mobilecareph.com',
    viber: '09613328304',
    viberLink: 'viber://chat?number=%2B639613328304',
    telLink: 'tel:09613328304',
    emailSubject: 'MDC Concerns & Logistics'
  },
  {
    id: 'zhon',
    name: 'Zhon Manaois',
    role: 'Parts Management Specialist / MDC Operations',
    focusTitle: 'For System-Related Issues',
    badge: 'System Issues',
    initials: 'ZM',
    tagColor: '#7c3aed',
    tagBg: '#ede9fe',
    tagBorder: '#ddd6fe',
    accentColor: '#7c3aed',
    icon: Code,
    scopeDescription: 'Contact Zhon primarily for system-related issues, bug reports, software errors, login/access problems, and data sync.',
    email: 'zhon.manaois@mobilecareph.com',
    viber: '09763543574',
    viberLink: 'viber://chat?number=%2B639763543574',
    telLink: 'tel:09763543574',
    emailSubject: 'DC System Technical Support'
  }
];

export default function Feedback() {
  const { currentUser, sites = [], showToast } = useApp();

  const userSite = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [sites, currentUser]);

  const [copiedKey, setCopiedKey] = useState(null);

  const handleCopy = (text, key, label) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    showToast(`${label} copied to clipboard`, 'success');
  };

  return (
    <div className="feedback-page-container" style={{ maxWidth: '1000px', margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Hero Banner */}
      <div
        className="card"
        style={{
          marginBottom: '20px',
          background: 'linear-gradient(135deg, #090f1d 0%, #0f172a 45%, #1e293b 100%)',
          color: '#ffffff',
          padding: '26px 30px',
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
              For system issues, technical glitches, or branch operational concerns, reach out directly using the verified channels below.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.25)', padding: '5px 12px', borderRadius: '8px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={15} /> Direct Developer Support
            </span>
          </div>
        </div>
      </div>

      {/* 2. Routing Guidance Banner */}
      <div
        className="card"
        style={{
          marginBottom: '24px',
          background: 'linear-gradient(135deg, #f8fafc 0%, #f0fdf4 40%, #f0f9ff 70%, #faf5ff 100%)',
          border: '1.5px solid #cbd5e1',
          borderLeft: '5px solid #0284c7',
          padding: '16px 20px',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#0284c7', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
            <Users size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '14.5px', fontWeight: 800, color: '#0f172a' }}>
                Support Contact Guidelines
              </h4>
              <span style={{ fontSize: '11px', fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', border: '1px solid #bbf7d0' }}>
                Primary Points of Contact
              </span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', marginBottom: '10px' }}>
              <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                <span style={{ fontSize: '12.5px', color: '#0f172a', lineHeight: 1.5 }}>
                  📦 Contact <strong>Joshua Juvida</strong> for <strong>MDC concerns</strong> (branch requisitions, stock replenishment, parts availability, and warehouse distribution).
                </span>
              </div>
              <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd6fe' }}>
                <span style={{ fontSize: '12.5px', color: '#0f172a', lineHeight: 1.5 }}>
                  💻 Contact <strong>Zhon Manaois</strong> for <strong>system-related issues</strong> (system bug reports, software errors, login/access problems, and data sync).
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#334155', background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '15px' }}>🤝</span>
              <span>
                <strong>Flexible Reach-Out:</strong> While Joshua is primarily for MDC concerns and Zhon for system issues, <em>you may reach out to either of them for any concern</em> — our team coordinates closely to ensure prompt resolution.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Contact Profile Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        {SUPPORT_CONTACTS.map((contact) => {
          const isJoshua = contact.id === 'joshua';
          return (
            <div
              key={contact.id}
              className="card"
              style={{
                padding: '24px',
                borderRadius: '14px',
                border: `1.5px solid ${contact.tagBorder}`,
                background: isJoshua 
                  ? 'linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%)' 
                  : 'linear-gradient(180deg, #f5f3ff 0%, #ffffff 100%)',
                boxShadow: isJoshua
                  ? '0 4px 14px rgba(2, 132, 199, 0.08)'
                  : '0 4px 14px rgba(124, 58, 237, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '16px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
                
                {/* Header: Avatar, Name, Role, and Focus Badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', minHeight: '56px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: '12px',
                        background: contact.accentColor,
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '16px',
                        boxShadow: `0 4px 10px ${contact.tagBorder}`,
                        flexShrink: 0
                      }}
                    >
                      {contact.initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                        {contact.name}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          fontWeight: 600,
                          marginTop: '3px',
                          lineHeight: 1.35,
                          minHeight: '34px',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        {contact.role}
                      </div>
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      background: contact.tagBg,
                      color: contact.tagColor,
                      border: `1px solid ${contact.tagBorder}`,
                      padding: '4px 9px',
                      borderRadius: '6px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      marginTop: '2px'
                    }}
                  >
                    {contact.badge}
                  </span>
                </div>

                {/* Scope Description Box */}
                <div
                  style={{
                    fontSize: '12.5px',
                    color: '#475569',
                    lineHeight: 1.5,
                    minHeight: '76px',
                    display: 'flex',
                    alignItems: 'center',
                    background: 'rgba(255, 255, 255, 0.75)',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(226, 232, 240, 0.8)',
                    boxSizing: 'border-box'
                  }}
                >
                  <div>
                    <strong style={{ color: contact.tagColor }}>{contact.focusTitle}:</strong>{' '}
                    {contact.scopeDescription}
                  </div>
                </div>

                {/* Email Section */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '14px',
                    minHeight: '124px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <Mail size={13} color={contact.accentColor} />
                        <span>Email Support</span>
                      </div>
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b' }}>Direct Email</span>
                    </div>

                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0f172a', margin: '2px 0 10px', wordBreak: 'break-all' }}>
                      {contact.email}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleCopy(contact.email, `${contact.id}-email`, `${contact.name}'s Email`)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12.5px', padding: '8px 12px', borderRadius: '8px', fontWeight: 700 }}
                      title={`Copy ${contact.name}'s Email Address`}
                    >
                      {copiedKey === `${contact.id}-email` ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                      <span>{copiedKey === `${contact.id}-email` ? 'Copied' : 'Copy Email'}</span>
                    </button>
                    <a
                      href={`mailto:${contact.email}?subject=%5B${encodeURIComponent(contact.emailSubject)}%20-%20${encodeURIComponent(userSite.code || 'BRANCH')}%5D`}
                      className="btn btn-primary"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12.5px', padding: '8px 12px', background: contact.accentColor, borderColor: contact.accentColor, textDecoration: 'none', borderRadius: '8px', fontWeight: 700 }}
                      title={`Open Email Client to message ${contact.name}`}
                    >
                      <ExternalLink size={14} />
                      <span>Send Email</span>
                    </a>
                  </div>
                </div>

                {/* Viber & Mobile Phone Section */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '14px',
                    minHeight: '124px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <Phone size={13} color="#7c3aed" />
                        <span>Viber &amp; Mobile Phone</span>
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 800, background: '#7c3aed', color: '#fff', padding: '1px 6px', borderRadius: '4px', letterSpacing: '0.04em' }}>
                        VIBER
                      </span>
                    </div>

                    <div style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '2px 0 10px', fontFamily: 'var(--font-mono)' }}>
                      <a href={contact.telLink} style={{ color: '#0f172a', textDecoration: 'none' }} title={`Call ${contact.name}`}>
                        {contact.viber}
                      </a>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleCopy(contact.viber, `${contact.id}-viber`, `${contact.name}'s Number`)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12.5px', padding: '8px 12px', borderRadius: '8px', fontWeight: 700 }}
                      title={`Copy ${contact.name}'s Number`}
                    >
                      {copiedKey === `${contact.id}-viber` ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                      <span>{copiedKey === `${contact.id}-viber` ? 'Copied' : 'Copy Number'}</span>
                    </button>
                    <a
                      href={contact.viberLink}
                      className="btn btn-primary"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12.5px', padding: '8px 12px', background: '#7c3aed', borderColor: '#7c3aed', textDecoration: 'none', borderRadius: '8px', fontWeight: 700 }}
                      title={`Open Viber Chat with ${contact.name}`}
                    >
                      <MessageCircle size={14} />
                      <span>Open Viber</span>
                    </a>
                  </div>
                </div>

              </div>

              {/* Bottom footer note */}
              <div
                style={{
                  paddingTop: '12px',
                  borderTop: '1px solid rgba(226, 232, 240, 0.8)',
                  fontSize: '11.5px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: '20px',
                  boxSizing: 'border-box'
                }}
              >
                <span>Available for branch inquiries</span>
                <span style={{ fontWeight: 700, color: contact.tagColor }}>{contact.focusTitle}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. Helpful Contact Notice / Quick Tips */}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            📍 <strong>Your Branch:</strong> {userSite.name} ({userSite.code})
          </div>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            🏷️ <strong>Reference:</strong> Part Number, Serial #, or Request ID
          </div>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            📸 <strong>Screenshots:</strong> Take a photo or screenshot of the screen/error
          </div>
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#334155' }}>
            ⚡ <strong>Urgent Blockers:</strong> Message either contact directly via Viber
          </div>
        </div>
      </div>
    </div>
  );
}
