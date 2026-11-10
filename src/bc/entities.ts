/**
 * Entity registry – the single source of truth for what the gateway exposes.
 *
 * Everything is derived from it: input validation, OData filter whitelisting,
 * output projection (no unexpected fields leak), OpenAPI/AsyncAPI documents,
 * MCP tool schemas and CloudEvent types. Field names follow the Business
 * Central API v2.0 so that clients can use Microsoft's documentation.
 */
export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'guid' | 'date' | 'datetime';

export interface FieldDef {
  type: FieldType;
  writable?: boolean;
  /** required on create */
  required?: boolean;
  maxLength?: number;
  enum?: string[];
  /** default true */
  filterable?: boolean;
  description?: string;
}

export type Operation = 'list' | 'get' | 'create' | 'update' | 'delete';

export interface EntityDef {
  /** entity set name = URL segment, e.g. "customers" */
  name: string;
  singular: string;
  description: string;
  /** BC API route below /api/, e.g. "v2.0" or "<publisher>/<group>/<version>" */
  apiRoute: string;
  operations: Operation[];
  fields: Record<string, FieldDef>;
  /** contains personal data (GDPR) – reads are always audited */
  personalData?: boolean;
  /** can be subscribed to via BC webhooks */
  webhooks?: boolean;
  /** requires the companion AL extension in bc-extension/ */
  requiresExtension?: boolean;
}

type F = Partial<FieldDef>;
const str = (maxLength?: number, o: F = {}): FieldDef => ({ type: 'string', ...(maxLength ? { maxLength } : {}), ...o });
const w = (maxLength?: number, o: F = {}): FieldDef => str(maxLength, { writable: true, ...o });
const num = (o: F = {}): FieldDef => ({ type: 'number', ...o });
const int = (o: F = {}): FieldDef => ({ type: 'integer', ...o });
const bool = (o: F = {}): FieldDef => ({ type: 'boolean', ...o });
const guid = (o: F = {}): FieldDef => ({ type: 'guid', ...o });
const date = (o: F = {}): FieldDef => ({ type: 'date', ...o });
const datetime = (o: F = {}): FieldDef => ({ type: 'datetime', ...o });

const id = guid({ description: 'System ID (GUID) of the record' });
const modified = datetime({ description: 'Last modification timestamp (UTC)' });

const address = {
  addressLine1: w(100),
  addressLine2: w(50),
  city: w(30),
  state: w(30),
  country: w(10),
  postalCode: w(20),
  phoneNumber: w(30),
  email: w(80),
  website: w(80),
};

export const ENTITIES: Record<string, EntityDef> = {
  customers: {
    name: 'customers',
    singular: 'customer',
    description: 'Debitoren / customers',
    apiRoute: 'v2.0',
    operations: ['list', 'get', 'create', 'update', 'delete'],
    personalData: true,
    webhooks: true,
    fields: {
      id,
      number: w(20),
      displayName: w(100, { required: true }),
      type: w(undefined, { enum: ['Company', 'Person'] }),
      ...address,
      salespersonCode: w(20),
      balanceDue: num(),
      creditLimit: num({ writable: true }),
      taxLiable: bool({ writable: true }),
      taxRegistrationNumber: w(20),
      currencyCode: w(10),
      paymentTermsId: guid({ writable: true }),
      shipmentMethodId: guid({ writable: true }),
      paymentMethodId: guid({ writable: true }),
      blocked: w(undefined, { enum: [' ', 'Ship', 'Invoice', 'All'] }),
      lastModifiedDateTime: modified,
    },
  },
  vendors: {
    name: 'vendors',
    singular: 'vendor',
    description: 'Kreditoren / vendors',
    apiRoute: 'v2.0',
    operations: ['list', 'get', 'create', 'update', 'delete'],
    personalData: true,
    webhooks: true,
    fields: {
      id,
      number: w(20),
      displayName: w(100, { required: true }),
      ...address,
      taxRegistrationNumber: w(20),
      currencyCode: w(10),
      paymentTermsId: guid({ writable: true }),
      paymentMethodId: guid({ writable: true }),
      taxLiable: bool({ writable: true }),
      blocked: w(undefined, { enum: [' ', 'Payment', 'All'] }),
      balance: num(),
      lastModifiedDateTime: modified,
    },
  },
  items: {
    name: 'items',
    singular: 'item',
    description: 'Artikel / items',
    apiRoute: 'v2.0',
    operations: ['list', 'get', 'create', 'update', 'delete'],
    webhooks: true,
    fields: {
      id,
      number: w(20),
      displayName: w(100, { required: true }),
      displayName2: w(50),
      type: w(undefined, { enum: ['Inventory', 'Service', 'Non-Inventory'] }),
      itemCategoryCode: w(20),
      blocked: bool({ writable: true }),
      gtin: w(14),
      inventory: num(),
      unitPrice: num({ writable: true }),
      priceIncludesTax: bool({ writable: true }),
      unitCost: num({ writable: true }),
      taxGroupCode: w(20),
      baseUnitOfMeasureCode: w(10),
      generalProductPostingGroupCode: w(20),
      inventoryPostingGroupCode: w(20),
      lastModifiedDateTime: modified,
    },
  },
  salesOrders: {
    name: 'salesOrders',
    singular: 'salesOrder',
    description: 'Verkaufsaufträge / sales orders',
    apiRoute: 'v2.0',
    operations: ['list', 'get', 'create', 'update', 'delete'],
    webhooks: true,
    fields: {
      id,
      number: str(20),
      externalDocumentNumber: w(35),
      orderDate: date({ writable: true }),
      postingDate: date({ writable: true }),
      customerId: guid({ writable: true }),
      customerNumber: w(20),
      customerName: str(100),
      billToCustomerNumber: w(20),
      shipToName: w(100),
      shipToContact: w(100),
      currencyCode: w(10),
      pricesIncludeTax: bool(),
      paymentTermsId: guid({ writable: true }),
      salesperson: w(20),
      requestedDeliveryDate: date({ writable: true }),
      discountAmount: num({ writable: true }),
      totalAmountExcludingTax: num(),
      totalTaxAmount: num(),
      totalAmountIncludingTax: num(),
      fullyShipped: bool(),
      status: str(undefined, { enum: ['Draft', 'In Review', 'Open', 'Released'] }),
      phoneNumber: w(30),
      email: w(80),
      lastModifiedDateTime: modified,
    },
  },
  salesInvoices: {
    name: 'salesInvoices',
    singular: 'salesInvoice',
    description: 'Verkaufsrechnungen / sales invoices (read-only)',
    apiRoute: 'v2.0',
    operations: ['list', 'get'],
    webhooks: true,
    fields: {
      id,
      number: str(20),
      externalDocumentNumber: str(35),
      invoiceDate: date(),
      postingDate: date(),
      dueDate: date(),
      customerId: guid(),
      customerNumber: str(20),
      customerName: str(100),
      currencyCode: str(10),
      orderNumber: str(20),
      totalAmountExcludingTax: num(),
      totalTaxAmount: num(),
      totalAmountIncludingTax: num(),
      remainingAmount: num(),
      status: str(undefined, { enum: ['Draft', 'In Review', 'Open', 'Paid', 'Canceled', 'Corrective'] }),
      lastModifiedDateTime: modified,
    },
  },
  purchaseInvoices: {
    name: 'purchaseInvoices',
    singular: 'purchaseInvoice',
    description: 'Einkaufsrechnungen / purchase invoices (read-only)',
    apiRoute: 'v2.0',
    operations: ['list', 'get'],
    webhooks: true,
    fields: {
      id,
      number: str(20),
      invoiceDate: date(),
      postingDate: date(),
      dueDate: date(),
      vendorInvoiceNumber: str(35),
      vendorId: guid(),
      vendorNumber: str(20),
      vendorName: str(100),
      currencyCode: str(10),
      totalAmountExcludingTax: num(),
      totalTaxAmount: num(),
      totalAmountIncludingTax: num(),
      status: str(undefined, { enum: ['Draft', 'In Review', 'Open', 'Paid', 'Canceled', 'Corrective'] }),
      lastModifiedDateTime: modified,
    },
  },
  accounts: {
    name: 'accounts',
    singular: 'account',
    description: 'Sachkonten / G/L accounts (read-only)',
    apiRoute: 'v2.0',
    operations: ['list', 'get'],
    fields: {
      id,
      number: str(20),
      displayName: str(100),
      category: str(),
      subCategory: str(80),
      blocked: bool(),
      accountType: str(),
      directPosting: bool(),
      netChange: num(),
      lastModifiedDateTime: modified,
    },
  },
  generalLedgerEntries: {
    name: 'generalLedgerEntries',
    singular: 'generalLedgerEntry',
    description: 'Sachposten / G/L entries (read-only)',
    apiRoute: 'v2.0',
    operations: ['list', 'get'],
    fields: {
      id,
      entryNumber: int(),
      postingDate: date(),
      documentNumber: str(20),
      documentType: str(),
      accountId: guid(),
      accountNumber: str(20),
      description: str(100),
      debitAmount: num(),
      creditAmount: num(),
      lastModifiedDateTime: modified,
    },
  },
  customerLedgerEntries: {
    name: 'customerLedgerEntries',
    singular: 'customerLedgerEntry',
    description: 'Debitorenposten / customer ledger entries – custom API from the OpenBridge AL extension',
    apiRoute: 'openbridge/interop/v1.0',
    operations: ['list', 'get'],
    requiresExtension: true,
    personalData: true,
    fields: {
      id,
      entryNumber: int(),
      customerNumber: str(20),
      postingDate: date(),
      documentType: str(),
      documentNumber: str(20),
      description: str(100),
      currencyCode: str(10),
      amount: num(),
      remainingAmount: num(),
      dueDate: date(),
      open: bool(),
      lastModifiedDateTime: modified,
    },
  },
  externalMappings: {
    name: 'externalMappings',
    singular: 'externalMapping',
    description: 'Externe ID-Zuordnungen / external ID mappings (external system id ↔ BC record) – custom API from the OpenBridge AL extension',
    apiRoute: 'openbridge/interop/v1.0',
    operations: ['list', 'get', 'create', 'update', 'delete'],
    requiresExtension: true,
    webhooks: true,
    fields: {
      id,
      sourceSystem: w(20, { description: 'External system, e.g. SHOPIFY. Defaults to the setup value when omitted.' }),
      externalId: w(250, { required: true }),
      entitySet: w(50, { required: true, description: 'Gateway entity set of the BC record, e.g. customers' }),
      bcSystemId: guid({ writable: true, description: 'id of the BC record' }),
      description: w(100),
      syncStatus: w(undefined, { enum: ['Pending', 'Synced', 'Failed'] }),
      lastSyncedAt: datetime({ writable: true }),
      lastError: w(250),
      lastModifiedDateTime: modified,
    },
  },
};

export const COMPANY_FIELDS: Record<string, FieldDef> = {
  id,
  systemVersion: str(),
  name: str(30),
  displayName: str(250),
  businessProfileId: str(250),
  systemCreatedAt: datetime(),
};

export function writableFields(e: EntityDef): string[] {
  return Object.entries(e.fields)
    .filter(([, f]) => f.writable)
    .map(([k]) => k);
}

/** Build a registry restricted to the configured entity sets (or all). */
export function selectEntities(names: string[]): Record<string, EntityDef> {
  if (names.length === 0) return ENTITIES;
  const out: Record<string, EntityDef> = {};
  for (const n of names) {
    if (!ENTITIES[n]) throw new Error(`Unknown entity set in BC_ENTITIES: ${n}`);
    out[n] = ENTITIES[n];
  }
  return out;
}
