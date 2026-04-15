import { NextRequest } from 'next/server';
import { updatePlantPricing } from '@/lib/supplier-inquiry';
import { connectDB } from '@/lib/db/connection';
import { Plant } from '@/lib/db/models';

/**
 * GET /api/supplier-pricing
 * Get current pricing for a plant or all plants with pricing data.
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const plantSlug = searchParams.get('plant');
    const supplierSlug = searchParams.get('supplier');

    if (plantSlug) {
      const plant = await Plant.findOne({ slug: plantSlug }).lean();
      if (!plant) {
        return Response.json({ error: 'Plant not found' }, { status: 404 });
      }

      const suppliers = (plant.suppliers || [])
        .filter((s: { pricing?: unknown[] }) => s.pricing && s.pricing.length > 0)
        .filter((s: { supplierSlug: string }) =>
          supplierSlug ? s.supplierSlug === supplierSlug : true,
        );

      return Response.json({
        plant: plant.slug,
        commonName: plant.commonName,
        suppliers,
      });
    }

    // Return all plants that have pricing data
    const filter = supplierSlug
      ? { 'suppliers.supplierSlug': supplierSlug, 'suppliers.pricing.0': { $exists: true } }
      : { 'suppliers.pricing.0': { $exists: true } };

    const plants = await Plant.find(filter)
      .select('slug commonName scientificName suppliers')
      .lean();

    return Response.json({
      count: plants.length,
      plants: plants.map((p) => ({
        slug: p.slug,
        commonName: p.commonName,
        scientificName: p.scientificName,
        suppliers: (p.suppliers || []).filter(
          (s: { pricing?: unknown[] }) => s.pricing && s.pricing.length > 0,
        ),
      })),
    });
  } catch (error) {
    console.error('Error fetching pricing:', error);
    return Response.json({ error: 'Failed to fetch pricing' }, { status: 500 });
  }
}

/**
 * POST /api/supplier-pricing
 * Bulk-update pricing for a supplier's plants.
 *
 * Body: {
 *   supplierSlug: string,
 *   inquiryId?: string,   // optional, to link response to inquiry
 *   updates: [{
 *     plantSlug: string,
 *     pricing: [{ format: string, price: number | null, inStock: boolean }]
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { supplierSlug, updates, inquiryId } = body;

    if (!supplierSlug || !updates || !Array.isArray(updates)) {
      return Response.json(
        { error: 'supplierSlug and updates array are required' },
        { status: 400 },
      );
    }

    const updatedCount = await updatePlantPricing(supplierSlug, updates);

    // If linked to an inquiry, mark it as responded
    if (inquiryId) {
      const { markInquiryResponded } = await import('@/lib/supplier-inquiry');
      await markInquiryResponded(inquiryId);
    }

    return Response.json({
      message: `Updated pricing for ${updatedCount} plants from ${supplierSlug}`,
      updatedCount,
    });
  } catch (error) {
    console.error('Error updating pricing:', error);
    return Response.json({ error: 'Failed to update pricing' }, { status: 500 });
  }
}
