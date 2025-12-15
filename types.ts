
export enum MultiplierType {
  Normal = 0,
  DoubleLetter = 1,
  TripleLetter = 2,
  DoubleWord = 3,
  TripleWord = 4,
  Center = 5
}

export enum RoundStatus {
  IDLE = 'IDLE',       // Preparant faristol (Ronda creada però no iniciada temps)
  PLAYING = 'PLAYING', // Ronda oberta, jugadors envien
  REVIEW = 'REVIEW',   // Ronda tancada per temps, master tria jugada
  COMPLETED = 'COMPLETED' // Ronda finalitzada, jugada mestra aplicada
}

export interface BoardCell {
  row: number;
  col: number;
  multiplier: MultiplierType;
  tile: Tile | null;
}

export interface Tile {
  char: string; 
  value: number;
  isBlank: boolean;
  displayChar: string; 
}

export interface PlayerMove {
  id: string;
  playerId: string; 
  playerName: string; 
  tableNumber: string; 
  word: string; 
  tiles: Tile[]; 
  row: number; 
  col: number; 
  direction: 'H' | 'V';
  score?: number; 
  timestamp: number; 
  roundNumber: number; 
  isMasterMove?: boolean; 
  isManual?: boolean; // Indica si la jugada ha estat introduïda manualment pel màster
  isValid?: boolean; 
  error?: string;    
  penalty?: boolean; 
}

export interface Participant {
    id: string; 
    name: string;
    tableNumber: string;
    group?: string; // Grup de competició (A, B, etc.)
    totalScore: number;
    roundScores: Record<number, number>;
    masterMovesCount?: number; // Nombre de vegades que ha fet la mateixa puntuació que el màster
}

// Nova estructura unificada per a la base de dades
export interface RoundData {
    roundNumber: number;
    status: RoundStatus;
    boardSnapshot: BoardCell[][]; // El tauler a l'INICI de la ronda (per validar)
    rack: string[];
    moves: Record<string, PlayerMove>; // Map de playerId -> Move
    masterMove?: PlayerMove | null;
    startTime?: number | null;
    endTime?: number | null;
    playerScoresSnapshot?: Record<string, Participant>;
}

export interface ArchivedRound extends RoundData {
    // Interfície de compatibilitat per al frontend (que espera array de moves)
    moves: any; 
}

export interface GameConfig {
  timerDurationSeconds: number;
  gracePeriodSeconds: number; 
  judgeName: string;
  bestMovesLimit?: number; // 0 = totes
  dictionary?: string; // 'DISC' | 'LEXIMOTS'
}

export interface GameState {
  // Dades globals
  id: string;
  status: RoundStatus; // Estat de la ronda ACTUAL
  round: number;       // Número de la ronda ACTUAL
  board: BoardCell[][]; // Tauler ACTUAL (resultat de l'última mestra)
  currentRack: string[]; // Faristol ACTUAL
  
  participants: Record<string, Participant>;
  config: GameConfig;
  
  // Dades derivades/processades per al frontend
  moves: PlayerMove[]; // Jugades de la ronda actual (convertit de Map a Array)
  lastPlayedMove: PlayerMove | null;
  history: ArchivedRound[]; // Llista de rondes anteriors (1 .. round-1)
  
  // Timer
  roundStartTime: number | null;
  timerEndTime: number | null;
  timerPausedRemaining: number | null;
}

export const DIGRAPH_MAP: Record<string, string> = {
  'QU': 'Û',
  'L·L': 'Ł', 'L.L': 'Ł', 'L-L': 'Ł', 'ĿL': 'Ł',
  'NY': 'Ý'
};

export const REVERSE_DIGRAPH_MAP: Record<string, string> = {
  'Û': 'QU',
  'Ł': 'L·L',
  'Ý': 'NY'
};

export const LETTER_VALUES: Record<string, number> = {
  'A': 1, 'E': 1, 'I': 1, 'R': 1, 'S': 1, 'N': 1, 'O': 1, 'T': 1, 'L': 1, 'U': 1,
  'C': 2, 'D': 2, 'M': 2,
  'B': 3, 'G': 3, 'P': 3,
  'F': 4, 'V': 4,
  'H': 8, 'J': 8, 'Q': 8, 'Z': 8,
  'Ç': 10, 'X': 10,
  'Ł': 10, // L·L
  'Ý': 10, // NY
  'Û': 8,  // QU
};