// ============================================================================
// Geocoder Component (Place & Address Search)
//
// "Geocoding" is the process of converting a written address or landmark name
// (e.g. "Paris, France" or "Times Square") into map coordinates (lon, lat).
//
// This component queries the OpenStreetMap Nominatim geocoding API and notifies
// the map view to zoom to the user's selected search result.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { Input } from 'antd';

interface GeocoderProps {
  onSelectLocation: (lon: number, lat: number, result: any) => void;
}

export default function Geocoder({ onSelectLocation }: GeocoderProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (val: string) => {
    if (!val.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}`, {
        headers: {
          'Accept': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const handleClickResult = (result: any) => {
    const lon = parseFloat(result.lon);
    const lat = parseFloat(result.lat);
    if (!isNaN(lon) && !isNaN(lat)) {
      onSelectLocation(lon, lat, result);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Input.Search
        placeholder="Search for cities, places..."
        allowClear
        loading={searching}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value.replace(/^\s+/, ''))}
        onSearch={(val) => handleSearch(val.trim())}
      />
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-180px)]">
        {searchResults.map((res: any, idx: number) => (
          <div
            key={idx}
            onClick={() => handleClickResult(res)}
            className="p-2.5 text-xs text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-primary rounded-lg border border-gray-100 cursor-pointer transition-all duration-150 leading-relaxed"
          >
            {res.display_name}
          </div>
        ))}
        {!searching && searchResults.length === 0 && searchQuery && (
          <div className="text-xs text-gray-400 text-center py-4">No results found.</div>
        )}
      </div>
    </div>
  );
}
