import { useState, useEffect } from 'react';
import dbStorage from '../utils/dbStorage';

export function usePeriodRecordsAndReports({
  currentUser: _currentUser,
  showToast: _showToast,
  broadcastCloudEvent: _broadcastCloudEvent,
  setCloudSyncStatus: _setCloudSyncStatus
} = {}) {
  const [stockTransferReports, setStockTransferReports] = useState([]);
  const [stockTransferMetadata, setStockTransferMetadata] = useState(null);

  // Clean up deprecated stock transfer reports cache
  useEffect(() => {
    try {
      localStorage.removeItem('mdc_stock_transfer_reports');
      localStorage.removeItem('mdc_stock_transfer_metadata');
      localStorage.removeItem('mdc_stock_transfer_updated_at');
    } catch (e) {}
    dbStorage.removeItem('mdc_stock_transfer_reports');
    dbStorage.removeItem('mdc_stock_transfer_metadata');
    dbStorage.removeItem('mdc_stock_transfer_updated_at');
  }, []);

  const importStockTransfersReport = async () => {};
  const clearStockTransfersReport = async () => {};

  return {
    stockTransferReports,
    setStockTransferReports,
    stockTransferMetadata,
    setStockTransferMetadata,
    importStockTransfersReport,
    clearStockTransfersReport
  };
}
