/**
 * Amounts travel as integer paise everywhere and are only turned into rupees for display.
 * Doing arithmetic on a float rupee value is how ₹499.00 becomes ₹498.99999999.
 */
export const rupees = (paise: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
