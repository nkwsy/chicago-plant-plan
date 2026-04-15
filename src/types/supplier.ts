export interface Supplier {
  slug: string;
  name: string;
  url: string;
  location: string;
  description: string;
  shipping: boolean;
  pickup: boolean;
  specialties: string[];
  phone: string;
  email: string;
}

export interface SupplierPriceInquiry {
  supplierSlug: string;
  supplierName: string;
  supplierEmail: string;
  plants: {
    slug: string;
    commonName: string;
    scientificName: string;
    formats: string[];
  }[];
  sentAt: Date;
  status: 'draft' | 'sent' | 'responded' | 'failed';
}
