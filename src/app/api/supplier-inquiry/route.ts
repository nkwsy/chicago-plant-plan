import { NextRequest } from 'next/server';
import {
  generateInquiryDrafts,
  saveInquiryDrafts,
  markInquirySent,
  markInquiryResponded,
} from '@/lib/supplier-inquiry';
import { connectDB } from '@/lib/db/connection';
import { PriceInquiry } from '@/lib/db/models';

/**
 * GET /api/supplier-inquiry
 * List past inquiries, optionally filtered by supplier or status.
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const supplierSlug = searchParams.get('supplier');
    const status = searchParams.get('status');

    const filter: Record<string, string> = {};
    if (supplierSlug) filter.supplierSlug = supplierSlug;
    if (status) filter.status = status;

    const inquiries = await PriceInquiry.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return Response.json({ inquiries });
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    return Response.json({ error: 'Failed to fetch inquiries' }, { status: 500 });
  }
}

/**
 * POST /api/supplier-inquiry
 * Generate and save inquiry drafts for all suppliers (or a specific one).
 *
 * Body: { supplierSlug?: string, sendEmails?: boolean }
 *
 * When sendEmails is true, the drafts are created in Gmail via the
 * scheduled task (which has Gmail access). This API just generates
 * the drafts and stores them in MongoDB.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { supplierSlug } = body;

    const drafts = await generateInquiryDrafts(supplierSlug);
    const saved = await saveInquiryDrafts(drafts);

    return Response.json({
      message: `Generated ${saved.length} inquiry drafts`,
      drafts: saved.map(d => ({
        inquiryId: d.inquiryId,
        supplierName: d.supplierName,
        supplierEmail: d.supplierEmail,
        plantCount: d.plants.length,
        subject: d.emailSubject,
      })),
    });
  } catch (error) {
    console.error('Error generating inquiries:', error);
    return Response.json({ error: 'Failed to generate inquiries' }, { status: 500 });
  }
}

/**
 * PUT /api/supplier-inquiry
 * Update inquiry status (sent, responded).
 *
 * Body: { inquiryId: string, status: 'sent' | 'responded' }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { inquiryId, status } = body;

    if (!inquiryId || !status) {
      return Response.json(
        { error: 'inquiryId and status are required' },
        { status: 400 },
      );
    }

    if (status === 'sent') {
      await markInquirySent(inquiryId);
    } else if (status === 'responded') {
      await markInquiryResponded(inquiryId);
    } else {
      return Response.json(
        { error: 'status must be "sent" or "responded"' },
        { status: 400 },
      );
    }

    return Response.json({ message: `Inquiry ${inquiryId} marked as ${status}` });
  } catch (error) {
    console.error('Error updating inquiry:', error);
    return Response.json({ error: 'Failed to update inquiry' }, { status: 500 });
  }
}
