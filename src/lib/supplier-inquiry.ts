import { SUPPLIERS } from './suppliers';
import { connectDB } from './db/connection';
import { Plant, PriceInquiry } from './db/models';
import { nanoid } from 'nanoid';

interface PlantForInquiry {
  slug: string;
  commonName: string;
  scientificName: string;
  formats: string[];
}

interface InquiryDraft {
  inquiryId: string;
  supplierSlug: string;
  supplierName: string;
  supplierEmail: string;
  plants: PlantForInquiry[];
  emailSubject: string;
  emailBody: string;
}

/**
 * Build a price/availability inquiry email for a single supplier,
 * listing every plant they carry and the formats we have on file.
 */
function buildInquiryEmail(
  supplierName: string,
  plants: PlantForInquiry[],
): { subject: string; body: string } {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const subject = `Native Plant Price & Availability Inquiry – Chicago Plant Plan (${today})`;

  const plantList = plants
    .map((p, i) => {
      const formats = p.formats.map(f => f.replace('_', ' ')).join(', ');
      return `  ${i + 1}. ${p.commonName} (${p.scientificName}) — formats: ${formats}`;
    })
    .join('\n');

  const body = `Dear ${supplierName} Team,

I am writing on behalf of the Chicago Native Plant Plan project to request your current pricing and availability for the following native plants. We maintain a community planning tool that helps Chicagoland residents design native plant gardens, and we'd like to keep our supplier information accurate and up to date.

Could you please provide current retail pricing and stock status for each of the following species in the formats listed?

${plantList}

For each plant, we'd appreciate:
  - Current retail price per unit for each format (seed packet, plug, potted, bare root)
  - Whether it is currently in stock or expected restock date
  - Any minimum order quantities

If you have a current price list or catalog that covers these species, a PDF or link would be perfect.

Thank you for your time. We're happy to link to your website and direct customers your way through our planning tool.

Best regards,
Chicago Native Plant Plan
https://chicagoplantplan.com`;

  return { subject, body };
}

/**
 * Generate inquiry drafts for all suppliers (or a specific one).
 * Each draft contains the email content and the plant list for that supplier.
 */
export async function generateInquiryDrafts(
  supplierSlug?: string,
): Promise<InquiryDraft[]> {
  await connectDB();

  const plants = await Plant.find({}).lean();
  const targetSuppliers = supplierSlug
    ? SUPPLIERS.filter(s => s.slug === supplierSlug)
    : SUPPLIERS;

  const drafts: InquiryDraft[] = [];

  for (const supplier of targetSuppliers) {
    // Find all plants this supplier carries
    const supplierPlants: PlantForInquiry[] = [];

    for (const plant of plants) {
      const match = plant.suppliers?.find(
        (s: { supplierSlug: string; availability: string[] }) =>
          s.supplierSlug === supplier.slug,
      );
      if (match) {
        supplierPlants.push({
          slug: plant.slug,
          commonName: plant.commonName,
          scientificName: plant.scientificName,
          formats: match.availability,
        });
      }
    }

    if (supplierPlants.length === 0) continue;

    const { subject, body } = buildInquiryEmail(supplier.name, supplierPlants);

    drafts.push({
      inquiryId: nanoid(12),
      supplierSlug: supplier.slug,
      supplierName: supplier.name,
      supplierEmail: supplier.email,
      plants: supplierPlants,
      emailSubject: subject,
      emailBody: body,
    });
  }

  return drafts;
}

/**
 * Save inquiry drafts to the database and return them.
 */
export async function saveInquiryDrafts(
  drafts: InquiryDraft[],
): Promise<InquiryDraft[]> {
  await connectDB();

  for (const draft of drafts) {
    await PriceInquiry.create({
      inquiryId: draft.inquiryId,
      supplierSlug: draft.supplierSlug,
      supplierName: draft.supplierName,
      supplierEmail: draft.supplierEmail,
      plants: draft.plants,
      emailSubject: draft.emailSubject,
      emailBody: draft.emailBody,
      status: 'draft',
      sentAt: new Date(),
    });
  }

  return drafts;
}

/**
 * Update plant pricing in the database from a supplier response.
 */
export async function updatePlantPricing(
  supplierSlug: string,
  pricingUpdates: {
    plantSlug: string;
    pricing: { format: string; price: number | null; inStock: boolean }[];
  }[],
): Promise<number> {
  await connectDB();

  let updated = 0;

  for (const update of pricingUpdates) {
    const result = await Plant.updateOne(
      { slug: update.plantSlug, 'suppliers.supplierSlug': supplierSlug },
      {
        $set: {
          'suppliers.$.pricing': update.pricing,
          'suppliers.$.lastPriceUpdate': new Date(),
        },
      },
    );
    if (result.modifiedCount > 0) updated++;
  }

  return updated;
}

/**
 * Mark an inquiry as sent (after email is actually dispatched).
 */
export async function markInquirySent(inquiryId: string): Promise<void> {
  await connectDB();
  await PriceInquiry.updateOne(
    { inquiryId },
    { $set: { status: 'sent', sentAt: new Date() } },
  );
}

/**
 * Mark an inquiry as responded.
 */
export async function markInquiryResponded(inquiryId: string): Promise<void> {
  await connectDB();
  await PriceInquiry.updateOne(
    { inquiryId },
    { $set: { status: 'responded', respondedAt: new Date() } },
  );
}
