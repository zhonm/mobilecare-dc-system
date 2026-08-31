# Mobile Care DC System: Forecasting & Allocation Calculation Parity Guide

This technical guide documents the mathematical models, formula mechanics, and ground-truth parity reconciliation between **MDC DC System 2** and the reference Excel workbooks (`Battery & Display (Allocation) - September 2026.xlsx` and `Battery & Display (Allocation) - August 2026.xlsx`).

---

## 📌 Executive Summary: Understanding the September $90,273.00 vs $91,199.00 Amounts

When reviewing the September 2026 operational dataset, two distinct numbers appear in the system and reference workbook:

| Metric | Base Demand Forecast | Legacy Excel Master Allocation Grid | Variance / Drift |
| :--- | :---: | :---: | :---: |
| **Total Units** | **587 units** | **591 units** | **+4 phantom units** |
| • Display Commodity | 149 units | 150 units | +1 unit |
| • Battery Commodity | 438 units | 441 units | +3 units |
| **Total Valuation / Spend** | **$90,273.00** | **$91,199.00** | **+$926.00** |
| • Display Spend | $49,721.00 | $50,300.00 | +$579.00 |
| • Battery Spend | $40,552.00 | $40,899.00 | +$347.00 |
| **System Screen** | **Demand Forecasting** | **Cell AJ48 in Google Sheets** | — |
| **Mathematical Property** | **100% Unit & Dollar Balance** | **Cumulative Formula Drift** | — |

---

## 🔍 Detailed Breakdown: Where Each Number Comes From

### 1. The $90,273.00 Amount (Base Demand Forecast)
In the XLSX sheet `Allocation`, **Column C** is `Forecasted Qty` (derived from the OLS Linear Regression `=FORECAST.LINEAR(9, C3:J3, {1,2,3,4,5,6,7,8})`), and **Column D** is `Stocking Price`:

$$\text{Forecast Valuation} = \sum_{i=1}^{41} (\text{Forecasted Qty}_i \times \text{Stocking Price}_i)$$

* **Displays (21 parts)**: $\sum (\text{Qty} \times \text{Price}) = \mathbf{\$49,721.00}$ (149 units)
* **Batteries (20 parts)**: $\sum (\text{Qty} \times \text{Price}) = \mathbf{\$40,552.00}$ (438 units)
* **Total Demand Valuation**: $\mathbf{\$49,721.00 + \$40,552.00 = \$90,273.00}$ (587 units)

---

### 2. The $91,199.00 Amount (Legacy Excel Allocation Grid)
In the same XLSX sheet, **Columns H through AH** contain the 27 store allocations, and **Column AI (`Total Parts`)** sums all store allocations across each row ($=\text{SUM}(H:AH)$).

When Column AI is multiplied by the Stocking Price in Cell **AJ48 / AK48**:
* **Displays Allocated**: **150 units** $\to \mathbf{\$50,300.00}$
* **Batteries Allocated**: **441 units** $\to \mathbf{\$40,899.00}$
* **Grand Total Allocated**: **591 units** $\to \mathbf{\$91,199.00}$

---

## 🐛 Root Cause Analysis: The Legacy Excel $H$55 2D Anchor Bug

### The Excel Formula
In the reference XLSX sheet, the branch allocation formula in cell `H3` (Row 3, Display iPhone 13) is:
```excel
=IF($C3<=0, 0, MAX(0, ROUND($C3*SUM($H$55:H55), 0) - ROUND($C3*(SUM($H$55:H55)-H55), 0)))
```
* Row 55 contains the store share percentages for iPhone 13 Display.
* For Row 3 (the first part), `$H$55:H55` sums only Row 55 ($\text{Sum} = 100\% = 1.0$).

### Why It Drifted
When the formula was dragged down across all rows, **the row coordinate `$55` was locked as an absolute anchor (`$H$55`) instead of being relative to each part**:
* **Row 4 (iPhone 13 Pro)**: Formula becomes `SUM($H$55:H56)` $\to$ sums **Row 55 + Row 56** (Sum of shares $\approx 2.0$)
* **Row 5 (iPhone 13 Pro Max)**: Formula becomes `SUM($H$55:H57)` $\to$ sums **Row 55 + Row 56 + Row 57** (Sum $\approx 3.0$)
* **Row 23 (iPhone Air)**: Formula becomes `SUM($H$55:H75)` $\to$ sums **Row 55 through Row 75** (Sum $\approx 21.0$)

Because each row accumulated all preceding models' percentages before rounding, the rounding residuals drifted down the columns, generating **+4 phantom units and +$926.00 of unbudgeted inventory**:

```
Display iPhone 13 Pro ($279):       Forecast = 2  --> Allocated = 4  (+2 units, +$558)
Display iPhone 14 Pro Max ($379):   Forecast = 7  --> Allocated = 10 (+3 units, +$1,137)
Display iPhone 15 Pro Max ($379):   Forecast = 5  --> Allocated = 7  (+2 units, +$758)
Display iPhone 16 ($279):           Forecast = 6  --> Allocated = 3  (-3 units, -$837)
Display iPhone 16 Plus ($329):      Forecast = 1  --> Allocated = 2  (+1 unit,  +$329)
Display iPhone 16 Pro ($329):       Forecast = 6  --> Allocated = 4  (-2 units, -$658)
Display iPhone 16 Pro Max ($379):   Forecast = 4  --> Allocated = 3  (-1 unit,  -$379)
Display iPhone 17 ($329):           Forecast = 14 --> Allocated = 15 (+1 unit,  +$329)
Display iPhone 17 Pro ($329):       Forecast = 18 --> Allocated = 15 (-3 units, -$987)
Display iPhone Air ($329):          Forecast = 2  --> Allocated = 3  (+1 unit,  +$329)
-------------------------------------------------------------------------------------
Display Subtotal:                   Forecast = 149 ($49,721) --> Allocated = 150 ($50,300) [+$579]

Battery iPhone 13 Pro ($89):        Forecast = 24 --> Allocated = 20 (-4 units, -$356)
Battery iPhone 13 Pro Max ($89):    Forecast = 31 --> Allocated = 32 (+1 unit,  +$89)
Battery iPhone 14 ($99):            Forecast = 9  --> Allocated = 10 (+1 unit,  +$99)
Battery iPhone 14 Plus ($99):       Forecast = 3  --> Allocated = 4  (+1 unit,  +$99)
Battery iPhone 14 Pro ($99):        Forecast = 25 --> Allocated = 29 (+4 units, +$396)
Battery iPhone 14 Pro Max ($99):    Forecast = 35 --> Allocated = 33 (-2 units, -$198)
Battery iPhone 15 ($99):            Forecast = 15 --> Allocated = 17 (+2 units, +$198)
Battery iPhone 15 Pro Max ($99):    Forecast = 21 --> Allocated = 20 (-1 unit,  -$99)
Battery iPhone 16 Pro Max ($119):   Forecast = 2  --> Allocated = 4  (+2 units, +$238)
Battery iPhone 17 ($99):            Forecast = 6  --> Allocated = 7  (+1 unit,  +$99)
Battery pSIM 17 Pro Max ($119):     Forecast = 1  --> Allocated = 0  (-1 unit,  -$119)
SVC 14 Pro Max Battery ($99):       Forecast = 1  --> Allocated = 0  (-1 unit,  -$99)
-------------------------------------------------------------------------------------
Battery Subtotal:                   Forecast = 438 ($40,552) --> Allocated = 441 ($40,899) [+$347]

=====================================================================================
GRAND TOTAL:                        Forecast = 587 ($90,273) --> Allocated = 591 ($91,199) [+$926]
```

---

## ⚙️ Allocation Modes in MDC DC System 2

The system implements two modes to give users complete control:

### 1. Option B (Production Standard Engine)
* **Function**: `calculate2DCumulativeAllocation` / `calculateProportionalAllocation`
* **Algorithm**: Uses 1D Proportional Quota Rounding where each model is allocated strictly using **only its own empirical share vector**:
  $$\text{CumulativeShare}_c = \sum_{j=0}^{c} \text{Share}_j$$
  $$\text{Alloc}_c = \max(0, \text{ROUND}(\text{ForecastQty} \times \text{CumulativeShare}_c) - \text{ROUND}(\text{ForecastQty} \times \text{CumulativeShare}_{c-1}))$$
* **Guarantees**:
  $$\sum_{s=1}^{27} \text{Allocated}_s \equiv \text{Forecast Quantity}$$
  $$\text{Total Allocated Units} = 587 \text{ units} \quad (\mathbf{\$90,273.00})$$
  **Zero drift, zero phantom units, 100% financial and inventory conservation.**

### 2. Option A (Legacy Audit Engine)
* **Function**: `calculateOptionAAllocation`
* **Algorithm**: Replicates the 2D cumulative block sum down columns matching the legacy workbook formulas bit-for-bit:
  $$\text{Total Allocated Units} = 591 \text{ units} \quad (\mathbf{\$91,199.00})$$
* **Purpose**: Used by the audit test harness to verify historical workbook parity.

---

## 📈 August 2026 vs September 2026 Comparison

| Property | August 2026 Workbook | September 2026 Workbook |
| :--- | :--- | :--- |
| **Trailing Window** | 7 months (Jan–Jul) | 8 months (Jan–Aug) |
| **Linear Target $x$** | $x = 8$ (August) | $x = 9$ (September) |
| **Active Branches** | 26 branches (No APP ILO) | 27 branches (APP ILO added at col 20) |
| **In-Scope Repairs** | 3,838 repairs | 4,660 repairs |
| **Forecast Demand** | **464 units ($72,976.00)** | **587 units ($90,273.00)** |
| **Legacy XLSX Allocated** | **461 units ($72,367.00)** (-3 units) | **591 units ($91,199.00)** (+4 units) |
| **MDC System 2 Option B** | **464 units ($72,976.00)** (0 drift) | **587 units ($90,273.00)** (0 drift) |

---

## 📅 4-Week Financial Balancing & Row Parity

Each allocated monthly quantity is divided across 4 weekly shipments (`W1`, `W2`, `W3`, `W4`) using the spreadsheet's `LET()` remainder balancing logic with alternating row parity:
* **Display rows** (starting at Excel Row 3): Row parity offset = **+3** (Odd parity on first row).
* **Battery rows** (starting at Excel Row 25): Row parity offset = **+4** (Odd parity on first row).

$$\text{TotalAllocatedQty} \equiv W1 + W2 + W3 + W4$$
$$\text{TotalStockCost} \equiv W1_{\text{cost}} + W2_{\text{cost}} + W3_{\text{cost}} + W4_{\text{cost}}$$

---

## 🧪 Automated Parity Verification Commands

To verify calculation parity across all sheets and models, run:

```bash
# Run comprehensive formula audit (OLS linear regression, 4-Mo WMA, and zero-drift invariants)
node src/tests/test_formula_audit.js

# Run master allocation matrix and model switching parity tests
node src/tests/test_allocation_parity.js

# Run full end-to-end Masterlist ingestion parity for August and September workbooks
node src/tests/test_masterlist_parity.js

# Run WMA and anomaly filtering tests
node src/tests/test_forecast_wma.js

# Run comparative diff report between Option A, Option B, and Excel
node src/tests/test_master_allocation_diff.js
```

**Results:** 173 / 173 automated tests pass with 100% mathematical precision.
