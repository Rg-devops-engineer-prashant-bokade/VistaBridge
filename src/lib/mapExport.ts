// ============================================================================
// Map Canvas Capture & Cartographic Utilities (mapExport.ts)
//
// In GIS, exporting high-resolution maps for printing requires:
// 1. Off-screen canvas capture scaled by DPI factor (e.g. 2x or 3x resolution)
// 2. Temporarily locking map rotation to 0° (North-up)
// 3. Stamping cartographic elements directly onto the canvas (North arrow compass)
// ============================================================================

import Map from 'ol/Map';
import { toLonLat } from 'ol/proj';

// Draws a styled North arrow compass with drop shadow onto the HTML5 Canvas
const drawNorthArrow = (context: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  const arrowSize = size;
  const arrowWidth = arrowSize * 0.6;
  
  // Shadow
  context.shadowColor = 'rgba(0, 0, 0, 0.3)';
  context.shadowBlur = 4;
  context.shadowOffsetX = 2;
  context.shadowOffsetY = 2;
  
  // Arrow shaft
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#000000';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, y - arrowSize);
  context.lineTo(x - arrowWidth / 3, y);
  context.lineTo(x, y - arrowSize * 0.3);
  context.lineTo(x + arrowWidth / 3, y);
  context.closePath();
  context.fill();
  context.stroke();
  
  context.shadowColor = 'transparent';
  
  // 'N' letter
  context.fillStyle = '#000000';
  context.font = `bold ${arrowSize * 0.5}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('N', x, y - arrowSize * 1.3);
};

/**
 * Capture map as high-quality canvas without rotation (always north-facing)
 */
export const captureMapAsCanvas = async (
  mapInstance: Map, 
  dpiScale: number = 1,
  _isPortrait: boolean = false
): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    if (!mapInstance) {
      reject(new Error('Map instance not available'));
      return;
    }

    try {
      const originalSize = mapInstance.getSize();
      if (!originalSize) {
        reject(new Error('Unable to get map size'));
        return;
      }

      const scaledWidth = Math.round(originalSize[0] * dpiScale);
      const scaledHeight = Math.round(originalSize[1] * dpiScale);

      const mapElement = mapInstance.getTargetElement();
      if (!mapElement) {
        reject(new Error('Map element not found'));
        return;
      }

      const originalWidth = (mapElement as HTMLElement).style.width;
      const originalHeight = (mapElement as HTMLElement).style.height;

      (mapElement as HTMLElement).style.width = `${scaledWidth}px`;
      (mapElement as HTMLElement).style.height = `${scaledHeight}px`;
      mapInstance.updateSize();
      mapInstance.renderSync();

      setTimeout(() => {
        try {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { alpha: false });
          
          if (!context) {
            reject(new Error('Unable to create canvas context'));
            return;
          }

          // No rotation - keep north-facing for both portrait and landscape
          canvas.width = scaledWidth;
          canvas.height = scaledHeight;

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);

          const canvases = mapElement.querySelectorAll('canvas');
          
          if (canvases.length === 0) {
            reject(new Error('No map canvas elements found'));
            return;
          }

          // Draw map without rotation
          canvases.forEach((mapCanvas) => {
            if (mapCanvas.width > 0 && mapCanvas.height > 0) {
              try {
                context.drawImage(mapCanvas, 0, 0, scaledWidth, scaledHeight);
              } catch (e) {
                console.warn('Could not draw canvas (possible CORS issue):', e);
                // Try to draw with error handling for tainted canvases
                try {
                  // Create a new canvas to test if source is tainted
                  const testCanvas = document.createElement('canvas');
                  testCanvas.width = mapCanvas.width;
                  testCanvas.height = mapCanvas.height;
                  const testCtx = testCanvas.getContext('2d');
                  if (testCtx) {
                    testCtx.drawImage(mapCanvas, 0, 0);
                    // If we get here, canvas is not tainted, try again
                    context.drawImage(mapCanvas, 0, 0, scaledWidth, scaledHeight);
                  }
                } catch {
                  console.error('Canvas is tainted by cross-origin content. Some tiles may not appear in export.');
                  // Draw a placeholder or continue with other canvases
                }
              }
            }
          });

          // Add north arrow at top-right corner
          const arrowSize = Math.min(scaledWidth, scaledHeight) * 0.04;
          const margin = arrowSize * 1.5;
          drawNorthArrow(context, canvas.width - margin, margin + arrowSize, arrowSize);

          (mapElement as HTMLElement).style.width = originalWidth;
          (mapElement as HTMLElement).style.height = originalHeight;
          mapInstance.updateSize();
          mapInstance.renderSync();

          resolve(canvas);
        } catch (error) {
          (mapElement as HTMLElement).style.width = originalWidth;
          (mapElement as HTMLElement).style.height = originalHeight;
          mapInstance.updateSize();
          reject(error);
        }
      }, 500);
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Download canvas as image file
 */
export const downloadCanvasAsImage = (canvas: HTMLCanvasElement, filename: string, format: 'png' | 'jpeg' = 'jpeg', quality: number = 0.95) => {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL(`image/${format}`, quality);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Get map metadata for export
 */
export const getMapMetadata = (mapInstance: Map) => {
  const view = mapInstance.getView();
  const center = view.getCenter();
  const zoom = view.getZoom();
  const resolution = view.getResolution();
  
  let scaleText = 'Unknown';
  let centerText = 'Unknown';
  
  if (resolution) {
    const dpi = 96;
    const inchesPerMeter = 39.37;
    const scale = Math.round(resolution * dpi * inchesPerMeter);
    scaleText = `1:${scale.toLocaleString()}`;
  }
  
  if (center) {
    const lonLat = toLonLat(center);
    centerText = `${lonLat[1].toFixed(6)}°N, ${lonLat[0].toFixed(6)}°E`;
  }
  
  return {
    scale: scaleText,
    center: centerText,
    zoom: zoom ? zoom.toFixed(1) : 'Unknown',
    projection: view.getProjection().getCode(),
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString()
  };
};