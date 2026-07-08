// Shapes of the database rows the app works with.

export type Category = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type Item = {
  id: string;
  category_id: string;
  name: string;
  price: number;
  gst_percent: number;
  is_active: boolean;
  image_url: string | null;
};

export type Ingredient = {
  id: string;
  name: string;
  unit: "kg" | "g" | "L" | "ml" | "pcs" | "pkt";
  current_stock: number;
  low_stock_threshold: number;
  cost_per_unit: number;
  is_active: boolean;
};

export type StockMovement = {
  id: string;
  ingredient_id: string;
  type: "purchase" | "usage" | "adjustment" | "wastage";
  quantity: number;
  note: string | null;
  created_at: string;
};

export type Vendor = {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  notes: string | null;
  is_active: boolean;
};

export type Purchase = {
  id: string;
  vendor_id: string;
  bill_number: string | null;
  bill_date: string;
  total_amount: number;
  status: "paid" | "partial" | "pending";
  created_at: string;
};

export type Sale = {
  id: string;
  bill_number: number;
  sale_date: string;
  subtotal: number;
  gst_amount: number;
  discount: number;
  total: number;
  payment_mode: "cash" | "upi" | "card" | "mixed";
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  price: number;
  gst_percent: number;
  line_total: number;
};

export type Expense = {
  id: string;
  category: "rent" | "salary" | "electricity" | "maintenance" | "misc";
  amount: number;
  expense_date: string;
  note: string | null;
};

export type Outlet = {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  phone: string | null;
};

export const GST_RATES = [0, 5, 12, 18] as const;
export const UNITS = ["kg", "g", "L", "ml", "pcs", "pkt"] as const;
export const EXPENSE_CATEGORIES = ["rent", "salary", "electricity", "maintenance", "misc"] as const;
