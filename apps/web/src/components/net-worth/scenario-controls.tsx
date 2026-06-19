/**
 * Scenario Controls Component
 * 
 * Provides interactive controls for adjusting net worth projection parameters.
 * Used in the net worth projection page for scenario modeling.
 */

import React from 'react';
import type { TimeHorizon, NetWorthProjectionInput } from '@budget-planner/core';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for ScenarioControls component
 */
export interface ScenarioControlsProps {
  /** Current input values for the projection */
  input: NetWorthProjectionInput;
  
  /** Called when any input value changes */
  onInputChange: (updatedInput: NetWorthProjectionInput) => void;
  
  /** Whether projection is currently in progress */
  isCalculating?: boolean;
}

/**
 * Individual control configuration
 */
interface ControlConfig {
  label: string;
  key: keyof NetWorthProjectionInput;
  type: 'number' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  description: string;
  formatValue?: (value: number | string | undefined) => string;
  parseValue?: (value: string) => number | string;
}

// ============================================================================
// Constants
// ============================================================================

const TIME_HORIZONS: { value: TimeHorizon; label: string }[] = [
  { value: '1y', label: '1 Year' },
  { value: '5y', label: '5 Years' },
  { value: '10y', label: '10 Years' },
  { value: 'custom', label: 'Custom' },
];

const CONTROLS: ControlConfig[] = [
  {
    label: 'Current Assets ($)',
    key: 'currentAssetsCents',
    type: 'number',
    min: 0,
    step: 10000, // $100 increments
    description: 'Your current total assets (investments, savings, etc.)',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(value / 100);
      }
      return typeof value === 'string' ? value : '';
    },
    parseValue: (value: string) => Math.round(parseFloat(value) * 100),
  },
  {
    label: 'Current Liabilities ($)',
    key: 'currentLiabilitiesCents',
    type: 'number',
    min: 0,
    step: 10000,
    description: 'Your current total liabilities (debts, loans, etc.)',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(value / 100);
      }
      return typeof value === 'string' ? value : '';
    },
    parseValue: (value: string) => Math.round(parseFloat(value) * 100),
  },
  {
    label: 'Monthly Net Income ($)',
    key: 'monthlyNetIncomeCents',
    type: 'number',
    min: -1000000,
    max: 1000000,
    step: 1000,
    description: 'Your monthly income minus expenses (can be negative)',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        const sign = value < 0 ? '-' : '';
        return `${sign}${new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(Math.abs(value) / 100)}`;
      }
      return typeof value === 'string' ? value : '';
    },
    parseValue: (value: string) => Math.round(parseFloat(value) * 100),
  },
  {
    label: 'Asset Return Rate (%)',
    key: 'assetReturnRate',
    type: 'number',
    min: -100,
    max: 100,
    step: 0.1,
    description: 'Expected annual return on your assets',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return `${(value * 100).toFixed(1)}%`;
      }
      return typeof value === 'string' ? value : '';
    },
    parseValue: (value: string) => parseFloat(value) / 100,
  },
  {
    label: 'Income Growth Rate (%)',
    key: 'incomeGrowthRate',
    type: 'number',
    min: -100,
    max: 100,
    step: 0.1,
    description: 'Expected annual growth rate for your net income',
    formatValue: (value: number | string | undefined) => {
      if (typeof value === 'number') {
        return `${(value * 100).toFixed(1)}%`;
      }
      return typeof value === 'string' ? value : '';
    },
    parseValue: (value: string) => parseFloat(value) / 100,
  },
  {
    label: 'Time Horizon',
    key: 'timeHorizon',
    type: 'select',
    options: TIME_HORIZONS,
    description: 'How far into the future to project',
    formatValue: (value: string | undefined) => {
      const option = TIME_HORIZONS.find(o => o.value === value);
      return option?.label ?? value ?? '';
    },
    parseValue: (value: string) => value as TimeHorizon,
  },
];

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Number input control with formatting
 */
function NumberControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  description,
  formatValue,
  parseValue,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (newValue: unknown) => void;
  min?: number;
  max?: number;
  step?: number;
  description: string;
  formatValue?: (value: number | string | undefined) => string;
  parseValue?: (value: string) => number | string;
  disabled?: boolean;
}) {
  const formattedValue = formatValue ? formatValue(value as number) : String(value);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseValue 
      ? parseValue(e.target.value)
      : parseFloat(e.target.value);
    onChange(newValue);
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={formattedValue}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
      />
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </div>
  );
}

/**
 * Select input control
 */
function SelectControl({
  label,
  value,
  onChange,
  options,
  description,
  formatValue,
  parseValue,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (newValue: unknown) => void;
  options?: { value: string; label: string }[];
  description: string;
  formatValue?: (value: number | string | undefined) => string;
  parseValue?: (value: string) => number | string;
  disabled?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = parseValue 
      ? parseValue(e.target.value)
      : e.target.value;
    onChange(newValue);
  };

  const formattedValue = formatValue ? formatValue(value as string) : String(value);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <select
        value={formattedValue}
        onChange={handleChange}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </div>
  );
}

// Custom input for when time horizon is custom
function CustomYearsInput({
  customYears,
  onChange,
  disabled,
}: {
  customYears: number | undefined;
  onChange: (years: number) => void;
  disabled?: boolean;
}) {
  if (!customYears && customYears !== 0) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const years = parseInt(e.target.value, 10);
    if (!isNaN(years) && years > 0 && years <= 50) {
      onChange(years);
    }
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Custom Years
      </label>
      <input
        type="number"
        value={customYears}
        onChange={handleChange}
        min={1}
        max={50}
        step={1}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
      />
      <p className="mt-1 text-xs text-gray-500">
        Number of years for custom projection (1-50)
      </p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ScenarioControls({
  input,
  onInputChange,
  isCalculating = false,
}: ScenarioControlsProps) {
  const handleChange = (key: keyof NetWorthProjectionInput, newValue: unknown) => {
    onInputChange({
      ...input,
      [key]: newValue,
    });
  };

  // Handle custom years change separately since it's not in the main input
  const handleCustomYearsChange = (years: number) => {
    onInputChange({
      ...input,
      timeHorizon: 'custom',
      customYears: years,
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">
        Projection Parameters
      </h2>
      
      <div className="space-y-4">
        {CONTROLS.map((control) => {
          const ControlComponent = control.type === 'select' ? SelectControl : NumberControl;
          return (
            <ControlComponent
              key={control.key}
              label={control.label}
              value={(input as Record<string, unknown>)[control.key]}
              onChange={(newValue) => handleChange(control.key, newValue)}
              disabled={isCalculating}
              {...control}
            />
          );
        })}
        
        {/* Custom years input - only shown when time horizon is custom */}
        {input.timeHorizon === 'custom' && (
          <CustomYearsInput
            customYears={input.customYears}
            onChange={handleCustomYearsChange}
            disabled={isCalculating}
          />
        )}
      </div>
      
      {/* Reset to defaults button */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={() => onInputChange({
            currentAssetsCents: 10000000, // $100,000
            currentLiabilitiesCents: 0,
            monthlyNetIncomeCents: 500000, // $5,000
            assetReturnRate: 0.07, // 7%
            incomeGrowthRate: 0.03, // 3%
            timeHorizon: '10y',
            customYears: undefined,
          })}
          disabled={isCalculating}
          className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
