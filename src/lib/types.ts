/**
 * Types and Interfaces for the Application
 */

// =============================================
// MAIN TYPES
// =============================================

export type UserRole = 'admin' | 'ibo' | 'user';
export type UserStatus = 'active' | 'inactive' | 'suspended';
export type AccountStatus = 'production' | 'nesting' | 'active' | 'drop' | 'not_in_project';
export type PaymentFrequency = 'weekly' | 'biweekly' | 'monthly';
export type PaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'partial';
export type PaymentMethod = 'transfer' | 'binance' | 'zelle' | 'other';
export type NotificationType = 'payment_reminder' | 'payment_confirmed' | 'payment_rejected' | 'new_account' | 'system';

// =============================================
// DATABASE INTERFACES
// =============================================

export interface User {
  id: string;
  telegram_id: number | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_photo_url: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
  ibo_id: string | null; // The IBO this user belongs to (null if direct or is IBO)
  percentage: number;
  payment_day: number | null;
  status: UserStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Platform {
  id: string;
  name: string;
  display_name: string;
  payment_schedule: string | null;
  logo_url: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  platform_id: string;
  project_id: string | null; // Project/Client (SafeRide, Teladoc, Agero, etc.)
  user_id: string | null; // Usuario o IBO asignado

  // Account details
  full_name: string; // Nombre completo de la cuenta
  account_email: string; // Email de la cuenta
  percentage: number; // Porcentaje que debe pagar el asignado

  // Payment schedule
  payment_frequency: PaymentFrequency; // weekly, biweekly, monthly
  payment_day: number | null; // For monthly: day of month (1-31). For weekly: day of week (0=Sun, 5=Fri)
  biweekly_first_day: number | null; // First payment day for biweekly
  biweekly_second_day: number | null; // Second payment day for biweekly
  next_payment_date: string | null; // Next calculated payment date

  // Status: production, drop, not_in_project
  status: AccountStatus;

  // Optional details
  notes: string | null;

  created_at: string;
  updated_at: string;

  // Relations
  platform?: Platform;
  project?: Project;
  user?: User; // Usuario o IBO asignado
}

export interface PaymentPeriod {
  id: string;
  platform_id: string;
  period_start: string;
  period_end: string;
  payment_date: string;
  description: string | null;
  created_at: string;
  platform?: Platform;
}

export interface Payment {
  id: string;
  user_id: string;
  account_id: string | null;
  period_id: string | null;
  platform_amount: number | null;
  percentage_applied: number;
  amount_owed: number;
  amount_paid: number;

  // Screenshots - Company payment proof
  company_screenshot_url: string | null;
  company_screenshot_file_id: string | null; // Telegram file_id

  // Screenshots - Payment sent proof
  payment_screenshot_url: string | null;
  payment_screenshot_file_id: string | null; // Telegram file_id

  // Legacy field (may still exist in old records)
  screenshot_url?: string | null;
  screenshot_uploaded_at: string | null;

  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  status: PaymentStatus;
  due_date: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  user_notes: string | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  user?: User;
  account?: Account;
  period?: PaymentPeriod;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// =============================================
// TELEGRAM TYPES
// =============================================

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramWebAppInitData {
  query_id?: string;
  user?: TelegramUser;
  auth_date: number;
  hash: string;
}

// =============================================
// UI / DASHBOARD TYPES
// =============================================

export interface DashboardStats {
  totalUsers: number;
  totalIBOs: number;
  pendingPayments: number;
  confirmedThisMonth: number;
  totalOwed: number;
  totalPaid: number;
  collectionRate: number;
}

export interface PaymentWithDetails extends Payment {
  user: User;
  account: Account & { platform: Platform };
}

export interface UserWithStats extends User {
  accounts: Account[];
  totalOwed: number;
  totalPaid: number;
  pendingPayments: number;
  lastPaymentDate: string | null;
}

// =============================================
// API TYPES
// =============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// =============================================
// FORM TYPES
// =============================================

export interface CreateUserForm {
  telegram_id?: number;
  telegram_username?: string;
  telegram_first_name?: string;
  phone?: string;
  email?: string;
  role: UserRole;
  ibo_id?: string;
  percentage: number;
  payment_day?: number;
}

export interface CreateAccountForm {
  platform_id: string;
  user_id?: string;
  ibo_id?: string;
  account_email: string;
  account_password?: string;
  email_password?: string;
  phone_number?: string;
  okta_agent?: string;
  lo_id?: string;
  program?: string;
  percentage_override?: number;
}

export interface SubmitPaymentForm {
  account_id: string;
  platform_amount: number;
  payment_method: PaymentMethod;
  payment_reference?: string;
  screenshot: File;
  notes?: string;
}

export interface ConfirmPaymentForm {
  payment_id: string;
  confirmed: boolean;
  admin_notes?: string;
  rejection_reason?: string;
}
