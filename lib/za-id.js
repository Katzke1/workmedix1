'use strict';

// South African ID number validation.
// Format: YYMMDD SSSS C A Z  (13 digits)
//   YYMMDD = date of birth
//   SSSS   = gender sequence (0000–4999 female, 5000–9999 male)
//   C      = citizenship (0 = SA citizen, 1 = permanent resident)
//   A      = usually 8 or 9
//   Z      = Luhn check digit

function luhnValid(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = +num[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Returns { valid, reason?, dob?, gender?, citizenship? }
function validateSaId(raw) {
  const id = String(raw || '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(id)) return { valid: false, reason: 'A South African ID number must be 13 digits' };

  const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6);
  if (mm < 1 || mm > 12) return { valid: false, reason: 'the ID number contains an invalid birth month' };

  const century  = yy <= (new Date().getFullYear() % 100) ? 2000 : 1900;
  const fullYear = century + yy;
  const d = new Date(fullYear, mm - 1, dd);
  if (d.getFullYear() !== fullYear || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
    return { valid: false, reason: 'the ID number contains an invalid date of birth' };
  }

  if (!luhnValid(id)) return { valid: false, reason: 'the ID number is not valid (checksum failed)' };

  return {
    valid: true,
    dob: `${fullYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
    gender: (+id.slice(6, 10) < 5000) ? 'Female' : 'Male',
    citizenship: (+id[10] === 0) ? 'SA Citizen' : 'Permanent Resident',
  };
}

module.exports = { validateSaId, luhnValid };
