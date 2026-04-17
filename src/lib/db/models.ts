import mongoose, { Schema, Document } from 'mongoose';

// Plant
export interface IPlant extends Document {
  slug: string;
  commonName: string;
  scientificName: string;
  family: string;
  plantType: string;
  heightMinInches: number;
  heightMaxInches: number;
  spreadMinInches: number;
  spreadMaxInches: number;
  sun: string[];
  moisture: string[];
  soilTypes: string[];
  bloomStartMonth: number;
  bloomEndMonth: number;
  bloomColor: string;
  nativeHabitats: string[];
  wildlifeValue: string[];
  effortLevel: string;
  deerResistant: boolean;
  description: string;
  careNotes: string;
  plantingInstructions: string;
  imageUrl: string;
  suppliers: {
    supplierSlug: string;
    availability: string[];
    pricing: { format: string; price: number | null; inStock: boolean }[];
    lastPriceUpdate: Date | null;
  }[];
  imageAttribution?: string;
  favorability?: number;
  tags?: string[];
  notes?: string;
  lastEnrichedAt?: Date | null;
  inatTaxonId?: number | null;
}

const PlantSchema = new Schema<IPlant>({
  slug: { type: String, required: true, unique: true, index: true },
  commonName: { type: String, required: true },
  scientificName: { type: String, required: true },
  family: String,
  plantType: { type: String, required: true },
  heightMinInches: Number,
  heightMaxInches: Number,
  spreadMinInches: Number,
  spreadMaxInches: Number,
  sun: [String],
  moisture: [String],
  soilTypes: [String],
  bloomStartMonth: Number,
  bloomEndMonth: Number,
  bloomColor: String,
  nativeHabitats: [String],
  wildlifeValue: [String],
  effortLevel: { type: String, required: true },
  deerResistant: { type: Boolean, default: false },
  description: String,
  careNotes: String,
  plantingInstructions: String,
  imageUrl: { type: String, default: '' },
  suppliers: [{
    supplierSlug: String,
    availability: [String],
    pricing: [{
      format: { type: String, enum: ['seed', 'plug', 'potted', 'bare_root'] },
      price: { type: Number, default: null },
      inStock: { type: Boolean, default: true },
    }],
    lastPriceUpdate: { type: Date, default: null },
  }],
  imageAttribution: { type: String, default: '' },
  // Curation / admin fields
  favorability: { type: Number, default: 50, min: 0, max: 100 },
  tags: { type: [String], default: [] },
  notes: { type: String, default: '' },
  lastEnrichedAt: { type: Date, default: null },
  inatTaxonId: { type: Number, default: null },
}, { timestamps: true });

PlantSchema.index({ sun: 1 });
PlantSchema.index({ moisture: 1 });
PlantSchema.index({ effortLevel: 1 });
PlantSchema.index({ nativeHabitats: 1 });
PlantSchema.index({ plantType: 1 });
PlantSchema.index({ favorability: -1 });

// Plan
export interface IPlan extends Document {
  planId: string;
  title: string;
  authorName: string;
  authorEmail: string;
  areaGeoJson: object;
  center: { type: string; coordinates: number[] };
  centerLat: number;
  centerLng: number;
  siteProfile: object | null;
  preferences: object | null;
  plants: {
    plantSlug: string;
    commonName: string;
    scientificName: string;
    gridX: number;
    gridY: number;
    quantity: number;
    bloomColor: string;
    heightMaxInches: number;
    notes: string;
  }[];
  gridCols: number;
  gridRows: number;
  areaSqFt: number;
  diversityScore: number;
  isPublic: boolean;
  exclusionZones: object[];
  existingTrees: object[];
  sunGrid: object | null;
  layoutVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>({
  planId: { type: String, required: true, unique: true, index: true },
  title: String,
  authorName: { type: String, default: '' },
  authorEmail: { type: String, default: '' },
  areaGeoJson: { type: Schema.Types.Mixed, required: true },
  center: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] },
  },
  centerLat: Number,
  centerLng: Number,
  siteProfile: Schema.Types.Mixed,
  preferences: Schema.Types.Mixed,
  plants: [{
    plantSlug: String,
    commonName: String,
    scientificName: String,
    gridX: Number,
    gridY: Number,
    quantity: { type: Number, default: 1 },
    bloomColor: String,
    heightMaxInches: Number,
    notes: { type: String, default: '' },
    lat: Number,
    lng: Number,
    imageUrl: { type: String, default: '' },
    spreadInches: Number,
    speciesIndex: Number,
    plantType: String,
    groupId: String,
  }],
  exclusionZones: Schema.Types.Mixed,
  existingTrees: Schema.Types.Mixed,
  sunGrid: Schema.Types.Mixed,
  layoutVersion: { type: Number, default: 1 },
  gridCols: { type: Number, default: 0 },
  gridRows: { type: Number, default: 0 },
  areaSqFt: { type: Number, default: 0 },
  diversityScore: { type: Number, default: 0 },
  isPublic: { type: Boolean, default: true },
}, { timestamps: true });

PlanSchema.index({ center: '2dsphere' });
PlanSchema.index({ isPublic: 1 });

// Quote Request
export interface IQuoteRequest extends Document {
  quoteId: string;
  planId: string;
  email: string;
  name: string;
  phone: string;
  notes: string;
  status: string;
  createdAt: Date;
}

const QuoteRequestSchema = new Schema<IQuoteRequest>({
  quoteId: { type: String, required: true, unique: true },
  planId: { type: String, required: true, index: true },
  email: { type: String, required: true },
  name: String,
  phone: String,
  notes: String,
  status: { type: String, default: 'pending', enum: ['pending', 'sent', 'replied'] },
}, { timestamps: true });

// API Cache
export interface IApiCache extends Document {
  cacheKey: string;
  response: object;
  fetchedAt: Date;
  expiresAt: Date;
}

const ApiCacheSchema = new Schema<IApiCache>({
  cacheKey: { type: String, required: true, unique: true },
  response: Schema.Types.Mixed,
  fetchedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

ApiCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Price Inquiry
export interface IPriceInquiry extends Document {
  inquiryId: string;
  supplierSlug: string;
  supplierName: string;
  supplierEmail: string;
  plants: {
    slug: string;
    commonName: string;
    scientificName: string;
    formats: string[];
  }[];
  emailSubject: string;
  emailBody: string;
  status: string;
  sentAt: Date;
  respondedAt: Date | null;
  createdAt: Date;
}

const PriceInquirySchema = new Schema<IPriceInquiry>({
  inquiryId: { type: String, required: true, unique: true },
  supplierSlug: { type: String, required: true, index: true },
  supplierName: String,
  supplierEmail: String,
  plants: [{
    slug: String,
    commonName: String,
    scientificName: String,
    formats: [String],
  }],
  emailSubject: String,
  emailBody: String,
  status: { type: String, default: 'draft', enum: ['draft', 'sent', 'responded', 'failed'] },
  sentAt: Date,
  respondedAt: { type: Date, default: null },
}, { timestamps: true });

PriceInquirySchema.index({ status: 1 });
PriceInquirySchema.index({ sentAt: -1 });

// Model getters (prevent re-compilation in dev)
export const Plant = mongoose.models.Plant || mongoose.model<IPlant>('Plant', PlantSchema);
export const Plan = mongoose.models.Plan || mongoose.model<IPlan>('Plan', PlanSchema);
export const QuoteRequest = mongoose.models.QuoteRequest || mongoose.model<IQuoteRequest>('QuoteRequest', QuoteRequestSchema);
export const ApiCache = mongoose.models.ApiCache || mongoose.model<IApiCache>('ApiCache', ApiCacheSchema);
export const PriceInquiry = mongoose.models.PriceInquiry || mongoose.model<IPriceInquiry>('PriceInquiry', PriceInquirySchema);
