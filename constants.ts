
import { MultiplierType } from './types';

export const BOARD_SIZE = 15;

// Coordinates for multipliers
export const TRIPLE_WORD_COORDS = [
  '0,0', '0,7', '0,14',
  '7,0', '7,14',
  '14,0', '14,7', '14,14'
];

export const DOUBLE_WORD_COORDS = [
  '1,1', '1,13',
  '2,2', '2,12',
  '3,3', '3,11',
  '4,4', '4,10',
  '10,4', '10,10',
  '11,3', '11,11',
  '12,2', '12,12',
  '13,1', '13,13'
];

export const TRIPLE_LETTER_COORDS = [
  '1,5', '1,9',
  '5,1', '5,5', '5,9', '5,13',
  '9,1', '9,5', '9,9', '9,13',
  '13,5', '13,9'
];

export const DOUBLE_LETTER_COORDS = [
  '0,3', '0,11',
  '2,6', '2,8',
  '3,0', '3,7', '3,14',
  '6,2', '6,6', '6,8', '6,12',
  '7,3', '7,11',
  '8,2', '8,6', '8,8', '8,12',
  '11,0', '11,7', '11,14',
  '12,6', '12,8',
  '14,3', '14,11'
];

// Files (Rows) són Lletres (A-O)
export const ROW_LABELS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];

// Columnes (Cols) són Nombres (1-15)
export const COL_LABELS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15'];

// Distribució exacta de fitxes Scrabble Català
export const TILE_COUNTS: Record<string, number> = {
    'A': 12,
    'B': 2,
    'C': 3,
    'Ç': 1,
    'D': 3,
    'E': 13,
    'F': 1,
    'G': 2,
    'H': 1,
    'I': 8,
    'J': 1,
    'L': 4,
    'Ł': 1, // L·L
    'M': 3,
    'N': 6,
    'O': 5,
    'P': 2,
    'R': 8,
    'S': 8,
    'T': 5,
    'U': 4,
    'Û': 1, // QU
    'V': 1,
    'X': 1,
    'Ý': 1, // NY
    'Z': 1,
    '?': 2  // Escarrassos
};
