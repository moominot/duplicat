
import { Participant } from '../types';

export const parsePlayersCSV = (csvContent: string): Partial<Participant>[] => {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const players: Partial<Participant>[] = [];
    
    // Detect if first line is header
    // We check if the first line contains "taula" or "table" or "nom" or "name"
    const firstLineLower = lines[0].toLowerCase();
    const hasHeader = firstLineLower.includes('taula') || firstLineLower.includes('table') || firstLineLower.includes('nom') || firstLineLower.includes('name');
    
    const startIndex = hasHeader ? 1 : 0;

    // Detect separator (comma or semicolon)
    const separator = lines[0].includes(';') ? ';' : ',';

    for (let i = startIndex; i < lines.length; i++) {
        const columns = lines[i].split(separator).map(c => c.trim());
        
        // Expected formats:
        // 1. Table, Name
        // 2. Table, Name, Group
        
        if (columns.length >= 2) {
            const tableNumber = columns[0];
            const name = columns[1].toUpperCase();
            // Si no hi ha grup definit, assignem cadena buida en comptes d'undefined
            const group = columns[2] ? columns[2].toUpperCase() : "";

            if (tableNumber && name) {
                players.push({
                    id: `table_${tableNumber}`,
                    tableNumber,
                    name,
                    group: group,
                    totalScore: 0,
                    roundScores: {}
                });
            }
        }
    }

    return players;
};
