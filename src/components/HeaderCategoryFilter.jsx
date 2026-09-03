import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Layers, ChevronDown, Check, RotateCcw } from 'lucide-react';

export default function HeaderCategoryFilter() {
  const {
    selectedCategories = ['BATTERY', 'DISPLAY'],
    setSelectedCategories,
    HARDWARE_CATEGORIES = [
      { code: 'BATTERY', name: 'Battery', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
      { code: 'DISPLAY', name: 'Display', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
      { code: 'CAMERA', name: 'Camera', color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8' },
      { code: 'BACK_GLASS', name: 'Back Glass', color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
      { code: 'MID_REAR', name: 'Mid/Rear System', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' }
    ],
    DEFAULT_SELECTED_CATEGORIES = ['BATTERY', 'DISPLAY']
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Derived button display label
  const isDefaultPreset =
    selectedCategories.length === 2 &&
    selectedCategories.includes('BATTERY') &&
    selectedCategories.includes('DISPLAY');

  const isAllSelected = selectedCategories.length === HARDWARE_CATEGORIES.length;

  let triggerLabel;
  if (isDefaultPreset) {
    triggerLabel = 'Both (Battery & Display)';
  } else if (isAllSelected) {
    triggerLabel = 'All Categories (All Parts)';
  } else if (selectedCategories.length === 1) {
    const matched = HARDWARE_CATEGORIES.find(c => c.code === selectedCategories[0]);
    triggerLabel = matched ? matched.name : selectedCategories[0];
  } else {
    triggerLabel = `${selectedCategories.length} Categories Selected`;
  }

  const handleToggleCategory = (code) => {
    if (selectedCategories.includes(code)) {
      // Prevent unchecking all
      if (selectedCategories.length === 1) {
        return;
      }
      setSelectedCategories(selectedCategories.filter(c => c !== code));
    } else {
      setSelectedCategories([...selectedCategories, code]);
    }
  };

  const handleSelectDefault = (e) => {
    e.stopPropagation();
    setSelectedCategories(DEFAULT_SELECTED_CATEGORIES);
  };

  const handleSelectAll = (e) => {
    e.stopPropagation();
    setSelectedCategories(HARDWARE_CATEGORIES.map(c => c.code));
  };

  return (
    <div className="header-category-dropdown-wrapper" ref={containerRef}>
      <button
        type="button"
        className={`header-category-dropdown ${isOpen ? 'active-dropdown' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title="Filter hardware parts by category (Multi-select checkboxes)"
      >
        <Layers size={13} className="header-category-icon" />
        <span className="header-category-label-text">
          {triggerLabel}
        </span>
        <ChevronDown
          size={13}
          className={`header-category-chevron ${isOpen ? 'chevron-rotated' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="category-popover-menu" role="dialog" aria-label="Hardware Category Filter">
          {/* Popover Header */}
          <div className="category-popover-header">
            <div className="category-popover-title-row">
              <span className="category-popover-title">Filter Hardware Parts</span>
              <span className="category-popover-badge">
                {selectedCategories.length} of {HARDWARE_CATEGORIES.length} Active
              </span>
            </div>
            <p className="category-popover-sub">
              Select which iPhone hardware categories to display, forecast, and allocate:
            </p>
          </div>

          {/* Quick Presets Bar */}
          <div className="category-popover-presets">
            <button
              type="button"
              className={`preset-btn ${isDefaultPreset ? 'preset-btn-active' : ''}`}
              onClick={handleSelectDefault}
              title="Standard default: Battery & Display only"
            >
              <RotateCcw size={10} style={{ marginRight: '4px' }} />
              Both (Batt & Disp)
            </button>
            <button
              type="button"
              className={`preset-btn ${isAllSelected ? 'preset-btn-active' : ''}`}
              onClick={handleSelectAll}
              title="Include all 5 hardware categories"
            >
              Select All
            </button>
          </div>

          {/* Checkboxes List */}
          <div className="category-popover-list">
            {HARDWARE_CATEGORIES.map((cat) => {
              const isChecked = selectedCategories.includes(cat.code);
              return (
                <label
                  key={cat.code}
                  className={`category-checkbox-row ${isChecked ? 'row-checked' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleToggleCategory(cat.code);
                  }}
                >
                  <div className={`custom-checkbox ${isChecked ? 'checkbox-checked' : ''}`}>
                    {isChecked && <Check size={11} strokeWidth={3} color="#ffffff" />}
                  </div>

                  <span
                    className="category-color-dot"
                    style={{ backgroundColor: cat.color }}
                  />

                  <span className="category-row-name">
                    {cat.name}
                  </span>

                  {isChecked && (
                    <span
                      className="category-row-tag"
                      style={{
                        backgroundColor: cat.bg,
                        color: cat.color,
                        borderColor: cat.border
                      }}
                    >
                      Active
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Popover Footer Info */}
          <div className="category-popover-footer">
            <span>Formula calculations update dynamically across the dashboard & reports.</span>
          </div>
        </div>
      )}
    </div>
  );
}
