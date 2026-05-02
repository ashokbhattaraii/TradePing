export const NEPSE_SECTORS: Record<string, string> = {
  // Commercial Banks
  NABIL: 'Commercial Banks',
  NICA: 'Commercial Banks',
  GBIME: 'Commercial Banks',
  SANIMA: 'Commercial Banks',
  NBL: 'Commercial Banks',
  SCB: 'Commercial Banks',
  PCBL: 'Commercial Banks',
  EBL: 'Commercial Banks',
  MBL: 'Commercial Banks',
  SBI: 'Commercial Banks',
  SBL: 'Commercial Banks',
  PRVU: 'Commercial Banks',
  CZBIL: 'Commercial Banks',
  NMB: 'Commercial Banks',

  // Dev Banks
  MNBBL: 'Development Banks',
  GBBL: 'Development Banks',
  JBBL: 'Development Banks',
  KSBBL: 'Development Banks',

  // Hydropower
  API: 'Hydropower',
  AHPC: 'Hydropower',
  CHCL: 'Hydropower',
  UPPER: 'Hydropower',
  NHPC: 'Hydropower',
  SHPC: 'Hydropower',

  // Manufacturing / Cement
  HDL: 'Manufacturing & Processing',
  SHIVM: 'Manufacturing & Processing',
  UNL: 'Manufacturing & Processing',
  CIT: 'Investment',
  NIFRA: 'Investment',
  NRIC: 'Investment', // Investment/Reinsurance
  PALPA: 'Manufacturing & Processing',
  PCIL: 'Manufacturing & Processing',

  // Life Insurance
  NLIC: 'Life Insurance',
  LICN: 'Life Insurance',
  ALICL: 'Life Insurance',

  // Non-Life Insurance
  SICL: 'Non-Life Insurance',
  NIL: 'Non-Life Insurance',
  PICL: 'Non-Life Insurance',
};

export function getSector(symbol: string): string {
  return NEPSE_SECTORS[symbol] || 'Others';
}
