// ============================================================================
// FuzzySearch Component (Layer Attribute Text Search)
//
// In GIS, users often want to find features quickly by typing a keyword
// (e.g., searching for a street name, parcel owner, or district name).
//
// This component performs debounced fuzzy text searches across all attribute
// columns in a selected vector layer, displays matching suggestions, and filters
// the map view accordingly.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Select, Button, Tag, Spin, Empty } from 'antd';
import { Search, X, FileJson } from 'lucide-react';
import { apiRequest } from '@/lib/api';

interface Suggestion {
  value: string;
  column?: string;
}

interface FuzzySearchProps {
  layers: Array<{ id: string; name: string; type?: string; data_type?: string }>;
  onSearch: (layerId: string, keywords: string[]) => void;
  loading?: boolean;
  selectedLayerId?: string;
  selectedKeywords?: string[];
  searchActive?: boolean;
}

export default function FuzzySearch({ layers, onSearch, loading, selectedLayerId = '', selectedKeywords = [], searchActive = false }: FuzzySearchProps) {
  const [searchValue, setSearchValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const vectorLayers = layers.filter(l => l.type === 'VECTOR' || l.data_type === 'VECTOR');


  const fetchSuggestions = useCallback(async (layerId: string, query: string) => {
    const cleanQuery = (query || '').trim();
    if (cleanQuery.length < 2 || !layerId) {
      setSuggestions([]);
      return;
    }

    setLoadingSuggestions(true);
    try {
      const params = new URLSearchParams({
        search: cleanQuery,
        page_size: '20'
      });

      const response = await apiRequest(`/datasets/${layerId}/features/?${params}`);
      if (!response.ok) throw new Error('Failed to fetch suggestions');

      const data = await response.json();

      const uniqueSuggestions = new Set<string>();
      data.data.forEach((feature: any) => {
        Object.entries(feature).forEach(([key, value]) => {
          if (typeof value === 'string' && value.toLowerCase().includes(cleanQuery.toLowerCase())) {
            if (key !== 'ogc_fid' && key !== 'fid' && key !== 'id' && key !== 'geom') {
              uniqueSuggestions.add(value.trim());
            }
          }
        });
      });

      setSuggestions(
        Array.from(uniqueSuggestions)
          .slice(0, 10)
          .map(val => ({ value: val }))
      );
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const cleanSearch = searchValue.trim();
    if (cleanSearch && selectedLayerId) {
      debounceTimerRef.current = setTimeout(() => {
        fetchSuggestions(selectedLayerId, cleanSearch);
      }, 300);
    } else {
      queueMicrotask(() => {
        setSuggestions([]);
      });
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchValue, selectedLayerId, fetchSuggestions]);

  const handleLayerChange = (value: string) => {
    onSearch(value, []);
    setSearchValue('');
    setSuggestions([]);
  };

  const _handleSearch = () => {
    if (selectedLayerId && selectedKeywords.length > 0) {
      onSearch(selectedLayerId, selectedKeywords);
    }
  };

  const handleClear = () => {
    onSearch(selectedLayerId, []);
    setSearchValue('');
    setSuggestions([]);
  };


  const handleSelectKeyword = (value: string) => {
    if (value && !selectedKeywords.includes(value) && selectedKeywords.length < 10) {
      const newKeywords = [...selectedKeywords, value];
      onSearch(selectedLayerId, newKeywords);
      setSearchValue('');
      setSuggestions([]);
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    const newKeywords = selectedKeywords.filter(k => k !== keyword);

    if (newKeywords.length === 0) {
      onSearch(selectedLayerId, []);
    } else {
      onSearch(selectedLayerId, newKeywords);
    }
  };


  const handleSearchClick = () => {
    if (selectedLayerId && selectedKeywords.length > 0) {
      onSearch(selectedLayerId, selectedKeywords);
    }
  };

  const canSearch = selectedLayerId && selectedKeywords.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {searchActive && (
        <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-green-600" />
            <span className="text-xs text-green-800 font-medium">
              Active: {selectedKeywords.join(', ')}
            </span>
          </div>
          <Button
            size="small"
            type="text"
            danger
            onClick={handleClear}
            className="text-xs font-medium"
          >
            Reset
          </Button>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Select Layer
        </label>
        <Select
          showSearch
          placeholder="Select a vector layer"
          value={selectedLayerId || undefined}
          onChange={handleLayerChange}
          filterOption={(input, option) =>
            (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
          }
          className="w-full"
          size="middle"
          optionRender={(option) => (
            <div className="flex items-center gap-1.5">
              <FileJson size={12} className="text-blue-500" />
              <span className="text-xs">{option.label}</span>
            </div>
          )}
          options={vectorLayers.map(l => ({
            label: l.name,
            value: l.id
          }))}
          notFoundContent={
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No vector layers"
              className="text-xs"
            />
          }
        />
      </div>

      {selectedLayerId && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Search Keywords
          </label>

          {selectedKeywords.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mb-2">
              {selectedKeywords.map((keyword) => (
                <Tag
                  key={keyword}
                  closable
                  onClose={() => handleRemoveKeyword(keyword)}
                  className="text-xs font-medium"
                >
                  {keyword}
                </Tag>
              ))}
            </div>
          )}

          <div className="relative">
            <Select
              showSearch
              value={null}
              searchValue={searchValue}
              onSearch={(val) => setSearchValue(val.replace(/^\s+/, ''))}
              onChange={handleSelectKeyword}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setDropdownOpen(false)}
              placeholder="Type to search keywords..."
              size="middle"
              className="w-full"
              filterOption={false}
              suffixIcon={
                loadingSuggestions ? (
                  <Spin size="small" />
                ) : canSearch ? (
                  <button
                    onClick={handleSearchClick}
                    disabled={loading}
                    className="flex items-center justify-center hover:opacity-70 transition-opacity disabled:opacity-50"
                  >
                    {loading ? <Spin size="small" /> : <Search size={14} className="text-primary cursor-pointer" />}
                  </button>
                ) : (
                  <Search size={14} className="text-gray-400" />
                )
              }
              notFoundContent={
                loadingSuggestions ? (
                  <div className="flex justify-center py-2">
                    <Spin size="small" />
                  </div>
                ) : !dropdownOpen || searchValue.trim().length === 0 ? null : searchValue.trim().length < 2 ? (
                  <div className="text-xs text-gray-400 text-center py-2">
                    Type at least 2 characters
                  </div>
                ) : suggestions.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No suggestions"
                    className="text-xs"
                  />
                ) : null
              }
              options={suggestions.map((s, idx) => ({
                label: s.value,
                value: s.value,
                key: idx
              }))}
              disabled={selectedKeywords.length >= 10}
            />
          </div>

          {selectedKeywords.length > 0 && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">
                {selectedKeywords.length}/10 keywords selected
              </span>
              <Button
                type="text"
                size="small"
                icon={<X size={14} />}
                onClick={handleClear}
                className="text-gray-400 hover:text-gray-600"
              >
                Clear All
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
