import { TransactionStatuses } from '../transactions';

/** Visible date cells on Yahav statement rows (DD/MM/YYYY). */
export const YAHAV_DATE_CELL_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

export interface YahavScrapedRow {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

function parseAmountNumber(s: string): number | null {
  const t = s.replace(/[₪\s]/g, '').trim();
  if (!t) {
    return null;
  }
  const n = parseFloat(t.replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

/** Yahav shows currency with agorot (e.g. 1,234.56); plain integers are references, not amounts. */
function isAmountLikeCell(text: string): boolean {
  const t = text.replace(/[₪\s]/g, '').trim();
  if (!/^\d{1,3}(,\d{3})*\.\d{2}$/.test(t) && !/^\d+\.\d{2}$/.test(t)) {
    return false;
  }
  const n = parseAmountNumber(text);
  return n !== null;
}

/**
 * Map a statement row's column texts (prefer direct children of `.entire-content-ctr`) to fields.
 * Tolerates an extra balance column and duplicate date-like noise.
 */
export function parseYahavTransactionRowCells(cellsInput: string[]): YahavScrapedRow | null {
  const cells = cellsInput.map(c => c.replace(/\s+/g, ' ').trim()).filter(c => c.length > 0);
  if (cells.length < 4) {
    return null;
  }

  const dateIdx = cells.findIndex(c => YAHAV_DATE_CELL_RE.test(c));
  if (dateIdx < 0) {
    return null;
  }
  const date = cells[dateIdx];

  const amountIndices: number[] = [];
  cells.forEach((c, i) => {
    if (i === dateIdx) {
      return;
    }
    if (isAmountLikeCell(c)) {
      amountIndices.push(i);
    }
  });

  if (amountIndices.length < 2) {
    return null;
  }

  const sortedAmountIdx = [...amountIndices].sort((a, b) => a - b);
  let debitIdx: number;
  let creditIdx: number;
  if (sortedAmountIdx.length >= 3) {
    debitIdx = sortedAmountIdx[sortedAmountIdx.length - 3];
    creditIdx = sortedAmountIdx[sortedAmountIdx.length - 2];
  } else {
    debitIdx = sortedAmountIdx[0];
    creditIdx = sortedAmountIdx[1];
  }

  const used = new Set<number>([dateIdx, debitIdx, creditIdx]);

  let reference: string | undefined;
  for (let i = 0; i < cells.length; i += 1) {
    if (used.has(i)) {
      continue;
    }
    const digits = cells[i].replace(/\D/g, '');
    if (digits.length >= 4 && /^\d+$/.test(digits)) {
      reference = digits;
      used.add(i);
      break;
    }
  }

  const descCandidates = cells
    .map((c, i) => ({ i, c }))
    .filter(({ i, c }) => !used.has(i) && !isAmountLikeCell(c) && c.length > 0);
  const description = descCandidates.sort((a, b) => b.c.length - a.c.length)[0]?.c ?? '';

  return {
    date,
    reference,
    description,
    debit: cells[debitIdx] ?? '',
    credit: cells[creditIdx] ?? '',
    memo: '',
    status: TransactionStatuses.Completed,
  };
}
