import { NextResponse } from 'next/server';
import { analyzeSite } from '@/lib/analysis/site-profile';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { lat, lng, existingTrees } = body;

    if (!lat || !lng || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
    }

    // Validate Chicago area (rough bounds)
    if (lat < 41.0 || lat > 42.5 || lng < -89.0 || lng > -87.0) {
      return NextResponse.json(
        { error: 'Location must be in the Chicagoland area' },
        { status: 400 }
      );
    }

    const profile = await analyzeSite(lat, lng, existingTrees || []);
    return NextResponse.json(profile);
  } catch (error) {
    console.error('Site analysis error:', error);
    return NextResponse.json(
      { error: 'Site analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}
