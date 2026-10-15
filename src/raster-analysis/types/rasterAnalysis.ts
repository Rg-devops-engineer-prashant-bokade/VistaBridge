// ============================================================================
// Raster Analysis Type Definitions (rasterAnalysis.ts)
//
// TypeScript data interfaces for raster processing:
// - RasterBoundingBox: [minX, minY, maxX, maxY] grid limits
// - RasterMetadata: native CRS, image dimensions, and band information
// - RasterProcess: WPS process descriptor (identifier, title, abstract)
// - ClassificationRange: lookup table bin ranges for raster reclassification
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RasterBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RasterMetadata {
  layerName: string;
  nativeCRS: string;
  bbox: RasterBoundingBox;
  latLonBbox?: RasterBoundingBox;
  gridOffsets?: [number, number];
  title?: string;
  rawBuffer?: ArrayBuffer;
  imageBlob?: Blob;
}

export interface RasterProcess {
  identifier: string;
  title: string;
  abstract: string;
}

export interface RasterProcessInput {
  identifier: string;
  title: string;
  abstract: string;
  required: boolean;
  type: 'complex' | 'literal' | 'bbox';
  dataType: string;
  defaultValue: any;
  supportedFormats?: string[];
  defaultFormat?: string;
  allowedValues?: any[];
}

export interface RasterProcessOutput {
  identifier: string;
  title: string;
  mimeType: string;
  supportedFormats?: string[];
}

export interface RasterExecutionResult {
  type: 'RASTER' | 'VECTOR';
  layerName?: string;
  imageUrl?: string;
  imageBlob?: Blob;
  rawBuffer?: ArrayBuffer;
  nativeCRS?: string;
  bbox?: number[];
  geojson?: any;
  data?: any;
  outputFormat?: string;
}

export interface LayerState {
  id: string;
  name: string;
  type: 'VECTOR' | 'RASTER' | 'POINTCLOUD' | 'GROUP';
  visible: boolean;
  opacity: number;
  labelsEnabled: boolean;
  styles?: any[];
  activeStyle?: string;
  bbox?: number[];
  rawBuffer?: ArrayBuffer;
  imageBlob?: Blob;
  imageUrl?: string;
  nativeCRS?: string;
}
