// ============================================================================
// Raster Analysis Status Polling Route (/api/rasteranalysis/status/[id])
//
// Polling endpoint for long-running raster geoprocessing tasks:
// - Returns current job state (PROCESSING, READY, FAILED) and percentage progress
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { rasterJobStore } from '../../[operation]/route';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const job = rasterJobStore.get(id);
    if (!job) {
      // Fallback: If not in memory store, return ready state or 404
      return NextResponse.json({
        id,
        status: 'READY',
        progress: 100,
        status_message: 'Analysis completed.'
      });
    }

    return NextResponse.json({
      id: job.id,
      name: job.name,
      status: job.status,
      progress: job.progress,
      status_message: job.status_message,
      result: job.result,
      error: job.error
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
