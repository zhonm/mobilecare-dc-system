import { useApp } from '../context/AppContext';
import { ShoppingCart, Barcode, UploadCloud } from 'lucide-react';

export default function PurchaseOrders() {
  const { purchaseOrders, setActiveTab, showToast } = useApp();

  return (
    <div className="purchase-orders-view" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '18px', margin: 0 }}>Purchase Orders (DC Replenishment)</h3>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
              Manage vendor POs placed against forecasted demand. Received units are serialized and scanned in.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                setActiveTab('scan-in');
                showToast('Switched to Scan-In Receiving Station', 'info');
              }}
            >
              <Barcode size={15} />
              <span>Receive PO Units</span>
            </button>
          </div>
        </div>
      </div>

      {/* PO List or Empty State */}
      {purchaseOrders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-strong)' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <ShoppingCart size={30} />
          </div>
          <h3 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--text-main)' }}>
            No Active Purchase Orders
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 20px', lineHeight: 1.5 }}>
            Inbound vendor purchase orders placed to replenish DC stock will appear here. You can generate forecasts via Data Import to calculate recommended replenishment orders.
          </p>
          <button className="btn btn-primary" onClick={() => setActiveTab('import')}>
            <UploadCloud size={16} />
            <span>Go to Fixably / GSX Data Import</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {purchaseOrders.map(po => {
            const totalOrdered = po.items?.reduce((s, it) => s + it.quantity_ordered, 0) || 0;
            const totalReceived = po.items?.reduce((s, it) => s + it.quantity_received, 0) || 0;
            const totalValue = po.items?.reduce((s, it) => s + (it.quantity_ordered * (it.unit_price || 0)), 0) || 0;
            const pct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;

            return (
              <div key={po.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ fontSize: '16px', margin: 0 }}>{po.po_number}</h3>
                      <span className={`badge ${po.status === 'received' ? 'badge-success' : 'badge-warning'}`}>
                        {po.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                      Order Date: {po.order_date} • Expected Arrival: {po.expected_date} • {po.remarks}
                    </p>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {totalReceived} / {totalOrdered} Units ({pct}%)
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Total Estimated Value: ${totalValue.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Fulfillment Progress Bar */}
                <div style={{ width: '100%', height: '6px', background: 'var(--bg-subtle)', borderRadius: '3px', overflow: 'hidden', marginBottom: '14px' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: pct === 100 ? 'var(--success)' : 'var(--primary)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>

                {/* Line Items Table */}
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Part Number</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'center' }}>Ordered</th>
                        <th style={{ textAlign: 'center' }}>Received</th>
                        <th style={{ textAlign: 'center' }}>Remaining</th>
                        <th style={{ textAlign: 'center' }}>Fulfillment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items?.map((item, idx) => {
                        const remaining = Math.max(0, item.quantity_ordered - item.quantity_received);
                        const itemPct = item.quantity_ordered > 0 ? Math.round((item.quantity_received / item.quantity_ordered) * 100) : 0;

                        return (
                          <tr key={idx}>
                            <td className="font-mono"><strong>{item.part_number}</strong></td>
                            <td>{item.description}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.quantity_ordered}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--primary)' }}>
                              {item.quantity_received}
                            </td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: remaining > 0 ? 'var(--warning-dark)' : 'var(--text-muted)' }}>
                              {remaining}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge ${itemPct === 100 ? 'badge-success' : 'badge-neutral'}`}>
                                {itemPct}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
