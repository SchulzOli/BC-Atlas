/** Deterministic demo data for the Business Central mock (fictional companies and people). */
import { createHash } from 'node:crypto';

export function guid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Rec = Record<string, unknown>;

export interface SeedCompany {
  company: Rec;
  data: Record<string, Rec[]>;
}

const TS = '2026-10-01T08:00:00Z';

function company(key: string, name: string, cities: string[], currency: string): SeedCompany {
  const id = guid(`company:${key}`);
  const g = (s: string) => guid(`${key}:${s}`);

  const customerNames = [
    'Nordwind Maschinenbau GmbH',
    'Alpenblick Hotel KG',
    'Rheinufer Logistik AG',
    'Sonnenfeld Bio-Markt e.K.',
    'Brückner & Söhne OHG',
    'Kranich Software GmbH',
    'Elbtal Bäckerei',
    'Westwind Energie GmbH',
    'Lindenhof Praxis Dr. Weber',
    'Seeblick Immobilien GmbH',
    'Falkenstein Werkzeuge AG',
    'Morgenrot Medien UG',
  ];
  const customers = customerNames.map((displayName, i) => ({
    id: g(`customer:${i}`),
    number: `D${10000 + i * 10}`,
    displayName,
    type: displayName.includes('Dr.') ? 'Person' : 'Company',
    addressLine1: `Hauptstraße ${i + 1}`,
    addressLine2: '',
    city: cities[i % cities.length],
    state: '',
    country: key === 'us' ? 'US' : 'DE',
    postalCode: String(10115 + i * 731).padStart(5, '0'),
    phoneNumber: `+49 30 5550${100 + i}`,
    email: `kontakt${i}@example.com`,
    website: '',
    salespersonCode: i % 2 ? 'JR' : 'KS',
    balanceDue: Math.round((i * 1234.56) % 25000 * 100) / 100,
    creditLimit: (i % 4) * 10000,
    taxLiable: true,
    taxRegistrationNumber: '',
    currencyCode: '',
    paymentTermsId: g('pt:14d'),
    shipmentMethodId: g('sm:exw'),
    paymentMethodId: g('pm:bank'),
    blocked: i === 11 ? 'All' : ' ',
    lastModifiedDateTime: TS,
  }));

  const vendors = ['Stahlwerk Ost GmbH', 'Papier & Co. KG', 'Elektro Huber', 'Datenwerk IT-Services', 'Grünland Agrar eG'].map((displayName, i) => ({
    id: g(`vendor:${i}`),
    number: `K${20000 + i * 10}`,
    displayName,
    addressLine1: `Industriestraße ${i + 3}`,
    addressLine2: '',
    city: cities[(i + 2) % cities.length],
    state: '',
    country: 'DE',
    postalCode: String(20095 + i * 311),
    phoneNumber: `+49 40 5551${200 + i}`,
    email: `einkauf${i}@example.org`,
    website: '',
    taxRegistrationNumber: '',
    currencyCode: '',
    paymentTermsId: g('pt:30d'),
    paymentMethodId: g('pm:bank'),
    taxLiable: true,
    blocked: ' ',
    balance: i * 2150.4,
    lastModifiedDateTime: TS,
  }));

  const itemNames = [
    ['Schreibtisch Eiche', 'Inventory', 649],
    ['Bürostuhl ergonomisch', 'Inventory', 389],
    ['Monitor 27"', 'Inventory', 279],
    ['Dockingstation USB-C', 'Inventory', 149],
    ['Montageservice (Std.)', 'Service', 85],
    ['Wartungsvertrag Jahr', 'Service', 1200],
    ['Kabelkanal 2 m', 'Inventory', 19.9],
    ['Versandpauschale', 'Non-Inventory', 9.5],
  ] as const;
  const items = itemNames.map(([displayName, type, unitPrice], i) => ({
    id: g(`item:${i}`),
    number: `${1000 + i}`,
    displayName,
    displayName2: '',
    type,
    itemCategoryCode: type === 'Service' ? 'DIENST' : 'MOEBEL',
    blocked: false,
    gtin: '',
    inventory: type === 'Inventory' ? 10 + i * 7 : 0,
    unitPrice,
    priceIncludesTax: false,
    unitCost: Math.round(unitPrice * 0.6 * 100) / 100,
    taxGroupCode: 'NORMAL',
    baseUnitOfMeasureCode: type === 'Service' ? 'STD' : 'STK',
    generalProductPostingGroupCode: 'HANDEL',
    inventoryPostingGroupCode: type === 'Inventory' ? 'HANDEL' : '',
    lastModifiedDateTime: TS,
  }));

  const salesOrders = [0, 1, 2, 3].map((i) => {
    const c = customers[i];
    const net = 1000 + i * 450;
    return {
      id: g(`so:${i}`),
      number: `AU-${101001 + i}`,
      externalDocumentNumber: `PO-${7700 + i}`,
      orderDate: `2026-10-0${i + 2}`,
      postingDate: `2026-10-0${i + 2}`,
      customerId: c.id,
      customerNumber: c.number,
      customerName: c.displayName,
      billToCustomerNumber: c.number,
      shipToName: c.displayName,
      shipToContact: '',
      currencyCode: '',
      pricesIncludeTax: false,
      paymentTermsId: g('pt:14d'),
      salesperson: c.salespersonCode,
      requestedDeliveryDate: `2026-10-${15 + i}`,
      discountAmount: 0,
      totalAmountExcludingTax: net,
      totalTaxAmount: Math.round(net * 0.19 * 100) / 100,
      totalAmountIncludingTax: Math.round(net * 1.19 * 100) / 100,
      fullyShipped: false,
      status: i === 0 ? 'Released' : 'Open',
      phoneNumber: c.phoneNumber,
      email: c.email,
      lastModifiedDateTime: TS,
    };
  });

  const salesInvoices = [0, 1, 2, 3, 4].map((i) => {
    const c = customers[(i + 2) % customers.length];
    const net = 500 + i * 830;
    return {
      id: g(`si:${i}`),
      number: `VR-${103001 + i}`,
      externalDocumentNumber: '',
      invoiceDate: `2026-09-${10 + i * 3}`,
      postingDate: `2026-09-${10 + i * 3}`,
      dueDate: `2026-09-${24 + i}`,
      customerId: c.id,
      customerNumber: c.number,
      customerName: c.displayName,
      currencyCode: '',
      orderNumber: '',
      totalAmountExcludingTax: net,
      totalTaxAmount: Math.round(net * 0.19 * 100) / 100,
      totalAmountIncludingTax: Math.round(net * 1.19 * 100) / 100,
      remainingAmount: i % 2 ? Math.round(net * 1.19 * 100) / 100 : 0,
      status: i % 2 ? 'Open' : 'Paid',
      lastModifiedDateTime: TS,
    };
  });

  const purchaseInvoices = [0, 1, 2].map((i) => {
    const v = vendors[i];
    const net = 2000 + i * 999;
    return {
      id: g(`pi:${i}`),
      number: `ER-${104001 + i}`,
      invoiceDate: `2026-09-0${i + 4}`,
      postingDate: `2026-09-0${i + 4}`,
      dueDate: `2026-10-0${i + 4}`,
      vendorInvoiceNumber: `RE-${55000 + i}`,
      vendorId: v.id,
      vendorNumber: v.number,
      vendorName: v.displayName,
      currencyCode: '',
      totalAmountExcludingTax: net,
      totalTaxAmount: Math.round(net * 0.19 * 100) / 100,
      totalAmountIncludingTax: Math.round(net * 1.19 * 100) / 100,
      status: 'Open',
      lastModifiedDateTime: TS,
    };
  });

  const accountDefs = [
    ['0200', 'Grundstücke', 'Assets'],
    ['1200', 'Bank', 'Assets'],
    ['1400', 'Forderungen aus L+L', 'Assets'],
    ['1600', 'Verbindlichkeiten aus L+L', 'Liabilities'],
    ['8400', 'Erlöse 19 % USt', 'Income'],
    ['4400', 'Wareneingang 19 % VSt', 'CostOfGoodsSold'],
  ] as const;
  const accounts = accountDefs.map(([number, displayName, category], i) => ({
    id: g(`acc:${number}`),
    number,
    displayName,
    category,
    subCategory: '',
    blocked: false,
    accountType: 'Posting',
    directPosting: i !== 2 && i !== 3,
    netChange: (i + 1) * 15432.1,
    lastModifiedDateTime: TS,
  }));

  const generalLedgerEntries = Array.from({ length: 10 }, (_, i) => {
    const a = accounts[i % accounts.length];
    return {
      id: g(`gle:${i}`),
      entryNumber: i + 1,
      postingDate: `2026-09-${String(1 + i * 2).padStart(2, '0')}`,
      documentNumber: `VR-${103001 + (i % 5)}`,
      documentType: i % 3 ? 'Invoice' : 'Payment',
      accountId: a.id,
      accountNumber: a.number,
      description: `Buchung ${i + 1}`,
      debitAmount: i % 2 ? 0 : 100 * (i + 1),
      creditAmount: i % 2 ? 100 * (i + 1) : 0,
      lastModifiedDateTime: TS,
    };
  });

  const customerLedgerEntries = salesInvoices.map((inv, i) => ({
    id: g(`cle:${i}`),
    entryNumber: 500 + i,
    customerNumber: inv.customerNumber,
    postingDate: inv.postingDate,
    documentType: 'Invoice',
    documentNumber: inv.number,
    description: `Rechnung ${inv.number}`,
    currencyCode: '',
    amount: inv.totalAmountIncludingTax,
    remainingAmount: inv.remainingAmount,
    dueDate: inv.dueDate,
    open: inv.remainingAmount > 0,
    lastModifiedDateTime: TS,
  }));

  return {
    company: {
      id,
      systemVersion: '27.0.38460.41097',
      timestamp: 0,
      name: key === 'us' ? 'CRONOS US' : 'CRONOS DE',
      displayName: name,
      businessProfileId: '',
      systemCreatedAt: '2025-01-01T00:00:00Z',
    },
    data: { customers, vendors, items, salesOrders, salesInvoices, purchaseInvoices, accounts, generalLedgerEntries, customerLedgerEntries, externalMappings: [] },
  };
}

export function seedCompanies(): SeedCompany[] {
  return [
    company('de', 'Cronos Handels GmbH (Demo)', ['Berlin', 'Hamburg', 'München', 'Köln', 'Leipzig'], 'EUR'),
    company('us', 'Cronos Trading Inc. (Demo)', ['Seattle', 'Boston', 'Austin'], 'USD'),
  ];
}
