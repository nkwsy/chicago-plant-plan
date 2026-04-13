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
}
